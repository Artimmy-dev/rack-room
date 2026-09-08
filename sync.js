'use strict';

/* ================= cloud sync =================
   Supabase over plain fetch — no SDK, no build step, keeping this app's zero
   dependencies. The app already holds all state in one JSON blob, so the cloud
   schema is one row per coach holding that same blob; parseState() validates
   whatever comes back, exactly as it does for a restored backup file.

   localStorage stays the source of truth for READS. The app boots, renders and
   runs a full session with no network — the cloud is a sync layer bolted on
   top, never a gate in front. A dead gym wifi must not cost anyone practice. */

// Paste from Supabase -> Project Settings -> API. SUPABASE_ANON takes the key
// labelled "Publishable" (older dashboards: "anon" / "public") — never the
// "Secret" / "service_role" one, which ignores Row Level Security and would
// hand every visitor full access to every account.
// Publishable keys are designed to ship in client code; the RLS policy in the
// README is what actually protects the data.
var SUPABASE_URL = 'https://yfdbcsemmcmxoxmebovw.supabase.co';
var SUPABASE_ANON = 'sb_publishable_dhsEPtIOGdjnCZp4_dnigw_zf8D9pTx';

var SESS_KEY = 'rackroom.session';
var session = null;
try { session = JSON.parse(localStorage.getItem(SESS_KEY) || 'null'); } catch (e) { session = null; }

function configured() { return !!(SUPABASE_URL && SUPABASE_ANON); }

function setSession(s) {
  session = s;
  if (s) localStorage.setItem(SESS_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESS_KEY);
  paintSync();
}

function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ apikey: SUPABASE_ANON, 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(SUPABASE_URL + path, opts).catch(function () {
    // fetch rejects with a bare "Failed to fetch" for DNS, offline and CORS alike
    throw new Error('No connection.');
  }).then(function (r) {
    return r.text().then(function (t) {
      var body = null;
      try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
      if (!r.ok) throw new Error((body && (body.error_description || body.msg || body.message)) || ('HTTP ' + r.status));
      return body;
    });
  });
}

/* ---- auth ---- */
function signIn(email, password) {
  return api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: email, password: password }) })
    .then(function (r) { setSession(r); return r; });
}

function signUp(email, password) {
  return api('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: email, password: password }) })
    .then(function (r) {
      // With "Confirm email" on (Supabase default) signup returns a user but no
      // token — there is nothing to sync until they click the link.
      if (r && r.access_token) { setSession(r); return true; }
      return false;
    });
}

function signOut() { setSession(null); }

// Access tokens expire (1h by default). Refresh just-in-time rather than on a timer.
function freshToken() {
  if (!session) return Promise.reject(new Error('signed out'));
  var expired = session.expires_at && (session.expires_at * 1000 - 60000) < Date.now();
  if (!expired) return Promise.resolve(session.access_token);
  return api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) })
    .then(function (r) { setSession(r); return r.access_token; })
    .catch(function (e) { setSession(null); throw e; }); // refresh token dead -> back to local-only
}

function rest(path, opts) {
  return freshToken().then(function (tok) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + tok }, opts.headers || {});
    return api('/rest/v1' + path, opts);
  });
}

/* ---- sync ----
   Whole-blob last-write-wins. state.syncedAt is the cloud's updated_at as of our
   last successful sync (server clock on both sides, so no skew maths); state.dirty
   is "this device has edits the cloud has not seen". Because every write is the
   whole document, the outbox is one boolean rather than an operation queue.
   ponytail: LWW at document granularity — two coaches editing one account on two
   devices at once, one set of edits loses. Per-entity rows if that ever shows up. */

function pushNow() {
  if (!session || !configured()) return Promise.resolve();
  var doc = JSON.parse(JSON.stringify(state));
  delete doc.dirty; delete doc.syncedAt; // sync bookkeeping is per-device, not shared
  return rest('/coach_state?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: session.user.id, doc: doc, updated_at: new Date().toISOString() })
  }).then(function (rows) {
    var row = rows && rows[0];
    if (row) state.syncedAt = row.updated_at;
    state.dirty = false;
    save(true);
    paintSync();
  });
}

function adopt(doc) {
  // Cloud blobs get the same validation and version migration as a restore file:
  // a doc written by an older build of the app must not brick this one.
  var s = parseState(JSON.stringify(doc));
  localStorage.setItem('rackroom.preSync', JSON.stringify(state)); // escape hatch, mirrors rackroom.bad
  s.dirty = false;
  state = s;
}

// Pure, so the one branch that can lose a coach's work is checkable. See test-sync.js.
function syncDecision(cloudChanged, localChanged) {
  if (cloudChanged && localChanged) return 'ask'; // both moved — cannot merge a whole blob
  if (cloudChanged) return 'adopt';
  if (localChanged) return 'push';
  return 'idle';
}

function pull() {
  if (!session || !configured()) return Promise.resolve();
  paintSync('syncing');
  return rest('/coach_state?select=doc,updated_at').then(function (rows) {
    var row = rows && rows[0];
    if (!row) return pushNow(); // first device on this account — seed the cloud

    var what = syncDecision(row.updated_at !== state.syncedAt, !!state.dirty);
    if (what === 'idle') { paintSync(); return; }
    if (what === 'push') return pushNow();
    if (what === 'ask' && !confirm(
      'This account has newer data in the cloud, and this device has changes that never went up.\n\n' +
      'OK  — use the CLOUD copy (the unsynced edits on this device are set aside in a recovery slot)\n' +
      'Cancel — keep THIS device’s copy and overwrite the cloud'
    )) return pushNow();

    adopt(row.doc);
    state.syncedAt = row.updated_at;
    save(true);
    if (typeof renderTab === 'function') renderTab(currentTab);
    paintSync();
  }).catch(function (e) {
    paintSync('offline');
    throw e;
  });
}

var pushTimer = null;
// Called by save() on every edit. Debounced: editing a workout fires save() per
// keystroke and none of those deserve their own round trip.
function cloudTouch() {
  if (!session || !configured()) return;
  state.dirty = true;
  paintSync('pending');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(function () { pushNow().catch(function () { paintSync('offline'); }); }, 2000);
}
window.cloudTouch = cloudTouch;

// Flush before the tab goes away — closing the laptop should not cost the last
// two seconds of edits.
document.addEventListener('visibilitychange', function () {
  if (document.hidden && state.dirty) pushNow().catch(function () {});
});

/* ---- ui ---- */
function paintSync(status) {
  var btn = $('#sync-btn');
  if (!btn) return;
  if (!configured()) { btn.hidden = true; return; }
  btn.hidden = false;
  if (!session) {
    btn.textContent = 'Sign in';
    btn.title = 'Working on this device only';
    btn.className = 'btn';
    return;
  }
  var who = (session.user && session.user.email) || 'signed in';
  btn.textContent = { syncing: 'Syncing…', pending: 'Saving…', offline: 'Offline' }[status] || 'Synced';
  btn.className = 'btn' + (status === 'offline' ? ' stale' : '');
  btn.title = who + (status === 'offline'
    ? ' — changes are safe on this device and go up when the connection returns'
    : '');
}

function showAuth(show) {
  $('#auth').hidden = !show;
  if (show) $('#auth-email').focus();
}

function authMsg(msg) {
  $('#auth-msg').textContent = msg || '';
  var busy = msg === 'Working…';
  $('#auth-in').disabled = busy;
  $('#auth-up').disabled = busy;
}

function authAttempt(fn) {
  var email = $('#auth-email').value.trim();
  var pw = $('#auth-pw').value;
  if (!email || !pw) { authMsg('Enter an email and a password.'); return; }
  authMsg('Working…');
  fn(email, pw).then(function (r) {
    if (r === false) { authMsg('Check your email for a confirmation link, then sign in.'); return; }
    authMsg('');
    showAuth(false);
    return pull();
  }).catch(function (e) { authMsg(e.message || 'Could not sign in.'); });
}

if (configured()) {
  $('#sync-btn').addEventListener('click', function () {
    if (!session) { showAuth(true); return; }
    if (confirm('Signed in as ' + ((session.user && session.user.email) || '') + '.\n\nSign out? This device keeps its own copy of everything.')) signOut();
  });
  $('#auth-in').addEventListener('click', function () { authAttempt(signIn); });
  $('#auth-up').addEventListener('click', function () { authAttempt(signUp); });
  $('#auth-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') authAttempt(signIn); });
  $('#auth-skip').addEventListener('click', function () { showAuth(false); });

  paintSync();
  // A stored session boots straight through, online or not. The sign-in screen is
  // only for a device that has never been used — never a gate in front of a coach
  // whose data is already sitting right here.
  if (session) pull().catch(function () {});
  else if (!state.athletes.length && !state.workouts.length) showAuth(true);
}
