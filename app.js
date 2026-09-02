'use strict';

/* ================= state ================= */
var LS_KEY = 'rackroom';
var MAX_KEYS = ['squat', 'bench', 'clean', 'deadlift'];
var MAX_LABELS = { squat: 'Squat', bench: 'Bench', clean: 'Clean', deadlift: 'Deadlift' };
var PLATE_COLORS = ['#e5484d', '#3b82f6', '#facc15', '#30a46c']; // red 55, blue 45, yellow 35, green 25 — cycles

function emptyState() {
  return {
    version: 2,
    athletes: [],
    workouts: [],
    activeSquad: '',
    grouping: { count: 2, mode: 'similar', stat: 'total', assignments: {} }
  };
}

function parseState(raw) { // validation + migration, shared by loadState and Restore
  var s = JSON.parse(raw);
  if (!s || typeof s !== 'object' || !Array.isArray(s.athletes)) throw new Error('bad shape');
  if (!Array.isArray(s.workouts)) s.workouts = [];
  if (typeof s.activeSquad !== 'string') s.activeSquad = '';
  if (!s.grouping || typeof s.grouping !== 'object') s.grouping = emptyState().grouping;
  if (!s.grouping.assignments || typeof s.grouping.assignments !== 'object') s.grouping.assignments = {};
  if (!(s.grouping.count >= 1)) s.grouping.count = 2; // NaN/undefined count bricks the Groups tab
  if (!(s.version >= 2)) { // v1 blocks: single exercise fields -> exercises array
    s.workouts.forEach(function (w) {
      if (!Array.isArray(w.blocks)) return;
      w.blocks.forEach(function (b) {
        if (!Array.isArray(b.exercises)) {
          b.exercises = [{ id: uuid(), name: b.exercise || '', reps: (isFinite(b.reps) && b.reps >= 1) ? b.reps : 5, maxKey: b.maxKey, pct: b.pct }];
          delete b.exercise; delete b.reps; delete b.maxKey; delete b.pct;
        }
      });
    });
    s.version = 2;
  }
  // deep guards: a truncated or hand-edited backup must not brick boot
  // (total() and workoutTotalSec() throw on missing shapes)
  s.athletes.forEach(function (a) {
    if (!a.maxes || typeof a.maxes !== 'object') a.maxes = {};
    if (a.hist !== undefined && (typeof a.hist !== 'object' || Array.isArray(a.hist))) delete a.hist;
    if (a.hist) Object.keys(a.hist).forEach(function (k) { // entries must be [dateString, number]
      a.hist[k] = (Array.isArray(a.hist[k]) ? a.hist[k] : []).filter(function (e) {
        return Array.isArray(e) && typeof e[0] === 'string' && isFinite(e[1]);
      });
    });
    // attendance marks expire: legacy out:true and past-day date strings clear to present
    if (a.out !== undefined && a.out !== today()) delete a.out;
  });
  s.workouts.forEach(function (w) {
    if (!isFinite(w.transitionSec) || w.transitionSec < 0) w.transitionSec = 0;
    if (w.stationMode) w.mode = 'station'; // pre-mode flag
    delete w.stationMode;
    if (w.mode !== 'sequential' && w.mode !== 'station') delete w.mode; // absent = rotational
    w.blocks = (Array.isArray(w.blocks) ? w.blocks : []).filter(function (b) { return Array.isArray(b.exercises) && b.exercises.length; });
    w.blocks.forEach(function (b) {
      if (!isFinite(b.sets) || b.sets < 1) b.sets = 1;
      if (!isFinite(b.workSec) || b.workSec < 0) b.workSec = 0;
      if (!isFinite(b.restSec) || b.restSec < 0) b.restSec = 0;
    });
  });
  return s;
}

function loadState() {
  var raw = localStorage.getItem(LS_KEY);
  if (raw == null) return emptyState();
  try {
    return parseState(raw);
  } catch (e) {
    localStorage.setItem('rackroom.bad', raw);
    return emptyState();
  }
}

var state = loadState();

function save() {
  // prune stale assignment ids
  var ids = {};
  state.athletes.forEach(function (a) { ids[a.id] = true; });
  Object.keys(state.grouping.assignments).forEach(function (id) {
    if (!ids[id]) delete state.grouping.assignments[id];
  });
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  refreshBackupBadge(); // hoisted; DOM is ready (script runs at end of body)
}

/* ================= helpers ================= */
function $(sel) { return document.querySelector(sel); }

function el(tag, attrs) {
  var n = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach(function (k) {
    var v = attrs[k];
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k === 'style') Object.keys(v).forEach(function (sk) { if (sk.slice(0, 2) === '--') n.style.setProperty(sk, v[sk]); else n.style[sk] = v[sk]; });
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else n.setAttribute(k, v === true ? '' : v);
  });
  for (var i = 2; i < arguments.length; i++) {
    var kid = arguments[i];
    if (kid == null) continue;
    if (Array.isArray(kid)) kid.forEach(function (c) { if (c != null) n.append(c); });
    else n.append(kid);
  }
  return n;
}

function uuid() {
  return (crypto.randomUUID) ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function total(a) {
  return MAX_KEYS.reduce(function (t, k) { return t + (a.maxes[k] || 0); }, 0);
}

function workingWeight(pct, max) {
  return Math.round(pct / 100 * max / 5) * 5;
}

// pct/reps waves: a value is a number ("85") or a per-set list ("70/80/90")
function parseList(v, lo, hi) { // -> number | array | null (invalid)
  var parts = String(v).split('/').map(function (s) { return parseInt(s.trim(), 10); });
  if (!parts.length || parts.some(function (n) { return !isFinite(n) || n < lo || n > hi; })) return null;
  return parts.length === 1 ? parts[0] : parts;
}

function fmtList(v) { return Array.isArray(v) ? v.join('/') : (v == null ? '' : String(v)); }

function forSet(v, setNum) { // waves clamp to their last entry
  return Array.isArray(v) ? v[Math.min(setNum - 1, v.length - 1)] : v;
}

function copyWave(v) { return Array.isArray(v) ? v.slice() : v; } // never share a wave array between exercises

function setMax(a, key, val) { // every max write routes here so history survives overwrites
  if (a.maxes[key] === val) return;
  a.maxes[key] = val;
  if (val == null) return; // clearing a cell isn't a data point
  a.hist = a.hist || {};
  var h = a.hist[key] = a.hist[key] || [];
  var last = h[h.length - 1];
  if (last && last[0] === today()) last[1] = val; // same-day edits collapse (typo fixes)
  else h.push([today(), val]);
}

var PLATES = [45, 35, 25, 10, 5, 2.5];
function platesPerSide(w) { // ponytail: 45lb bar hardcoded; add a bar-weight setting if a rack runs a 35
  var side = (w - 45) / 2, out = [];
  if (side < 0) return null;
  PLATES.forEach(function (p) { while (side >= p) { side -= p; out.push(p); } });
  return out;
}

function fmtClock(sec) { // M:SS
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

function fmtClockPad(sec) { // MM:SS
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

function shortName(name) {
  var p = name.trim().split(/\s+/);
  return p.length > 1 ? p[0][0] + '. ' + p[p.length - 1] : name;
}

function plateColor(i) { return PLATE_COLORS[i % PLATE_COLORS.length]; }

function today() { // local date, not UTC — marks must expire at local midnight
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function isOut(a) { return a.out === today(); } // out marks carry the day they were set

function squadOf(a) { return a.squad || ''; }

function roster() { // athletes on the active squad — every roster-facing view reads this
  var s = state.activeSquad || '';
  return state.athletes.filter(function (a) { return squadOf(a) === s; });
}

function presentAthletes() { return roster().filter(function (a) { return !isOut(a); }); }

function maxRacks() { return Math.min(8, Math.max(1, roster().length)); } // squad size, not today's attendance

/* ================= tabs ================= */
var currentTab = 'athletes';

document.querySelectorAll('.tab').forEach(function (btn) {
  btn.addEventListener('click', function () { showTab(btn.dataset.tab); });
});

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(function (b) {
    b.classList.toggle('is-active', b.dataset.tab === name);
  });
  ['athletes', 'workouts', 'groups'].forEach(function (t) {
    $('#tab-' + t).hidden = (t !== name);
  });
  renderTab(name);
}

function renderTab(name) {
  renderSquadSel();
  if (name === 'athletes') renderAthletes();
  else if (name === 'workouts') renderWorkouts();
  else renderGroups();
}

/* ================= squads ================= */
function allSquads() {
  var set = {};
  state.athletes.forEach(function (a) { set[squadOf(a)] = true; });
  set[state.activeSquad || ''] = true;
  return Object.keys(set).sort();
}

function renderSquadSel() {
  var sel = $('#squad-sel');
  sel.innerHTML = '';
  allSquads().forEach(function (s) {
    sel.append(el('option', { value: s, selected: s === (state.activeSquad || '') }, s === '' ? 'Main squad' : s));
  });
  sel.append(el('option', { value: '__new__' }, '+ New squad…'));
}

$('#squad-sel').addEventListener('change', function () {
  var sel = $('#squad-sel');
  if (sel.value === '__new__') {
    var name = (prompt('Squad name (e.g. JV, Soccer):') || '').trim();
    if (name && name !== '__new__') state.activeSquad = name;
  } else {
    state.activeSquad = sel.value;
  }
  save();
  renderTab(currentTab);
});

/* ================= athletes tab ================= */
var SAMPLE_TEAM = [
  ['Jaylen Carter', 365, 245, 205, 435],
  ['Marcus Webb', 315, 225, 185, 405],
  ['DeShawn Riley', 345, 235, 195, 415],
  ['Andre Mitchell', 335, 215, 185, 385],
  ['Sam Okafor', 305, 195, 175, 345],
  ['Chris Delgado', 295, 205, 165, 365],
  ['Tyler Brooks', 275, 185, 155, 335],
  ['Owen Zhang', 255, 175, null, 315],
  ['Luke Hoffman', 225, 155, 135, 295],
  ['Ricky Alvarez', 205, 145, 125, 265],
  ['Ben Whitaker', 185, 135, null, 225],
  ['Cole Jensen', 165, 120, 105, 210]
];

function parseMax(v) {
  // "225x5" / "225 x 5" = rep max -> estimated 1RM (Epley), rounded to 5
  var m = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d{1,2})\s*$/i.exec(String(v));
  if (m) {
    var w = parseFloat(m[1]), r = parseInt(m[2], 10);
    if (!(w > 0) || r < 1) return null;
    return r === 1 ? w : Math.round(w * (1 + r / 30) / 5) * 5;
  }
  var n = parseFloat(v);
  return (isFinite(n) && n > 0) ? n : null;
}

var pasteOpen = false;
var pasteMsg = '';

function importRoster(text) {
  var updated = 0, added = 0, skipped = 0;
  text.split(/\r?\n/).forEach(function (line) {
    if (!line.trim()) return;
    var cells = line.split('\t').map(function (c) { return c.trim(); });
    var name = cells[0];
    if (!name) { skipped++; return; }
    if (name.toLowerCase() === 'name') return; // pasted header row
    var vals = MAX_KEYS.map(function (k, i) { return parseMax(cells[i + 1]); });
    var existing = roster().find(function (a) { return a.name.trim().toLowerCase() === name.toLowerCase(); });
    if (existing) {
      MAX_KEYS.forEach(function (k, i) { if (vals[i] != null) setMax(existing, k, vals[i]); });
      updated++;
    } else {
      var na = { id: uuid(), name: name, maxes: { squat: null, bench: null, clean: null, deadlift: null } };
      MAX_KEYS.forEach(function (k, i) { if (vals[i] != null) setMax(na, k, vals[i]); });
      if (state.activeSquad) na.squad = state.activeSquad;
      state.athletes.push(na);
      added++;
    }
  });
  save();
  pasteOpen = false;
  pasteMsg = updated + ' updated, ' + added + ' added' + (skipped ? ', ' + skipped + ' skipped' : '');
  renderAthletes();
}

function renderAthletes() {
  var root = $('#tab-athletes');
  root.innerHTML = '';

  root.append(el('div', { class: 'roster-bar' },
    el('button', {
      class: 'btn', onclick: function () { pasteOpen = !pasteOpen; pasteMsg = ''; renderAthletes(); if (pasteOpen) $('#paste-ta').focus(); }
    }, 'Paste roster'),
    pasteMsg ? el('span', { class: 'roster-msg' }, pasteMsg) : null));
  if (pasteOpen) {
    var ta = el('textarea', {
      id: 'paste-ta', rows: '8',
      placeholder: 'Paste rows from Excel or Google Sheets.\nColumns: Name, Squat, Bench, Clean, Deadlift — rep maxes like 225x5 work too.\nExisting athletes are matched by name and updated; new names are added.'
    });
    root.append(el('div', { class: 'paste-panel' }, ta,
      el('div', { class: 'paste-actions' },
        el('button', { class: 'btn', onclick: function () { pasteOpen = false; renderAthletes(); } }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: function () { importRoster(ta.value); } }, 'Import'))));
  }

  var table = el('table', {}, el('thead', {}, el('tr', {},
    el('th', { title: 'Attendance' }, ''),
    el('th', {}, 'Name'),
    el('th', { class: 'num' }, 'Squat'),
    el('th', { class: 'num' }, 'Bench'),
    el('th', { class: 'num' }, 'Clean'),
    el('th', { class: 'num' }, 'Deadlift'),
    el('th', { class: 'num' }, 'Total'),
    el('th', { title: 'Personal workout shown on the TV instead of the one being run' }, 'Plan'),
    el('th', {}, '')
  )));
  var tbody = el('tbody');
  table.append(tbody);

  // quick-add row
  var qInputs = {};
  var qaRow = el('tr', { class: 'quickadd' }, el('td', {}));
  // max fields are type=text so rep-max entry ("225x5") parses
  var fields = [['name', 'Name'], ['squat', 'Sq'], ['bench', 'Be'], ['clean', 'Cl'], ['deadlift', 'DL']];
  fields.forEach(function (f) {
    var input = el('input', {
      id: 'qa-' + f[0], type: 'text', placeholder: f[1],
      title: f[0] === 'name' ? null : 'Max, or rep max like 225x5',
      onkeydown: function (e) { if (e.key === 'Enter') commitQuickAdd(); }
    });
    qInputs[f[0]] = input;
    qaRow.append(el('td', {}, input));
  });
  qaRow.append(el('td', {}), el('td', {}), el('td', {}));
  tbody.append(qaRow);

  function commitQuickAdd() {
    var name = qInputs.name.value.trim();
    if (!name) { qInputs.name.focus(); return; }
    var a = { id: uuid(), name: name, maxes: { squat: null, bench: null, clean: null, deadlift: null } };
    MAX_KEYS.forEach(function (k) {
      var v = parseMax(qInputs[k].value);
      if (v != null) setMax(a, k, v);
    });
    if (state.activeSquad) a.squad = state.activeSquad;
    state.athletes.push(a);
    save();
    renderAthletes();
    $('#qa-name').focus();
  }

  var sorted = roster().sort(function (a, b) { return a.name.localeCompare(b.name); });
  sorted.forEach(function (a) {
    var out = isOut(a);
    var tr = el('tr', { class: out ? 'is-out' : null });
    tr.append(el('td', { class: 'att' }, el('button', {
      class: 'att-btn' + (out ? ' is-out' : ''),
      title: out ? 'Out today — click to mark in' : 'In today — click to mark out',
      'aria-label': out ? 'Mark ' + a.name + ' in' : 'Mark ' + a.name + ' out',
      onclick: function () { if (isOut(a)) delete a.out; else a.out = today(); save(); renderAthletes(); }
    }, out ? '○' : '●')));
    tr.append(editableCell(a, 'name'));
    MAX_KEYS.forEach(function (k) { tr.append(editableCell(a, k)); });
    tr.append(el('td', { class: 'num total' }, String(total(a))));
    var psel = el('select', {
      class: 'plan-sel', 'aria-label': 'Plan for ' + a.name,
      onchange: function () {
        if (psel.value) a.workoutId = psel.value; else delete a.workoutId;
        save();
      }
    }, el('option', { value: '' }, '—'),
      state.workouts.map(function (w) { return el('option', { value: w.id, selected: a.workoutId === w.id }, w.name); }));
    tr.append(el('td', {}, psel));
    tr.append(el('td', {}, el('button', {
      class: 'trash', 'aria-label': 'Delete ' + a.name,
      onclick: function () {
        if (!confirm('Delete ' + a.name + '?')) return;
        state.athletes = state.athletes.filter(function (x) { return x.id !== a.id; });
        delete state.grouping.assignments[a.id];
        save();
        renderAthletes();
      }
    }, '✕')));
    tbody.append(tr);
  });

  root.append(table);

  if (roster().length === 0) {
    root.append(el('div', { class: 'empty-msg' },
      el('div', {}, 'No athletes yet. Add one above, or'),
      el('button', {
        class: 'btn', onclick: function () {
          SAMPLE_TEAM.forEach(function (s) {
            var a = { id: uuid(), name: s[0], maxes: { squat: null, bench: null, clean: null, deadlift: null } };
            MAX_KEYS.forEach(function (k, i) { if (s[i + 1] != null) setMax(a, k, s[i + 1]); });
            if (state.activeSquad) a.squad = state.activeSquad;
            state.athletes.push(a);
          });
          save();
          renderAthletes();
        }
      }, 'Load sample team')));
  }
}

function maxCellContent(td, athlete, key) { // value + season delta badge + history tooltip
  td.innerHTML = '';
  var v = athlete.maxes[key];
  td.append(v == null ? '—' : String(v));
  var h = athlete.hist && athlete.hist[key];
  if (v != null && h && h.length > 1) {
    var d = v - h[0][1];
    if (d !== 0) td.append(el('span', { class: 'max-delta' + (d < 0 ? ' neg' : '') }, (d > 0 ? '+' : '') + d));
  }
  td.title = h && h.length
    ? h.slice(-8).map(function (e) { return e[0].slice(2) + ': ' + e[1]; }).join(' → ')
    : '';
}

function editableCell(athlete, key) {
  var isName = key === 'name';
  var td = el('td', { class: 'editable' + (isName ? '' : ' num'), tabindex: '0' });
  if (isName) td.append(athlete.name);
  else maxCellContent(td, athlete, key);

  function beginEdit() {
    if (td.querySelector('input')) return;
    var input = el('input', {
      class: 'cell-edit', type: 'text',
      title: isName ? null : 'Max, or rep max like 225x5',
      value: isName ? athlete.name : (athlete.maxes[key] == null ? '' : athlete.maxes[key])
    });
    td.textContent = '';
    td.append(input);
    input.focus();
    input.select();
    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var v = input.value.trim();
      if (isName) {
        if (v) athlete.name = v;
        save();
        renderAthletes(); // row order can change
      } else {
        setMax(athlete, key, v === '' ? null : (parseMax(v) != null ? parseMax(v) : athlete.maxes[key]));
        save();
        // update in place: a full re-render on blur swallows the click that caused it,
        // making every next cell need two clicks
        maxCellContent(td, athlete, key);
        var totalTd = td.parentNode.querySelector('td.total');
        if (totalTd) totalTd.textContent = String(total(athlete));
      }
    }
    function cancel() {
      if (done) return;
      done = true;
      renderAthletes();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') cancel();
    });
    input.addEventListener('blur', commit);
  }

  td.addEventListener('click', beginEdit);
  td.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && !td.querySelector('input')) { e.preventDefault(); beginEdit(); }
  });
  return td;
}

/* ================= workouts tab ================= */
var selectedWorkoutId = null;

function workoutTotalSec(w) {
  var t = 0;
  w.blocks.forEach(function (b) { t += blockDurSec(b); });
  if (w.blocks.length > 1) t += (w.blocks.length - 1) * w.transitionSec;
  return t;
}

function workoutMode(w) { return w.mode || 'rotational'; }

// sequential: round r of a block is exercise floor(r / sets), set (r % sets) + 1
function seqExIndex(block, roundIdx) { return Math.min(Math.floor(roundIdx / block.sets), block.exercises.length - 1); }

function blockDurSec(b) {
  var rounds = b.sets * b.exercises.length;
  return rounds * b.workSec + (rounds - 1) * b.restSec;
}

// starting points for a new workout; ex = [name, reps, maxKey, pct]
function mkBlock(sets, workSec, restSec, exs) {
  return {
    id: uuid(), sets: sets, workSec: workSec, restSec: restSec,
    exercises: exs.map(function (x) { return { id: uuid(), name: x[0], reps: x[1], maxKey: x[2] || null, pct: x[3] == null ? null : x[3] }; })
  };
}

var TEMPLATES = [
  { name: 'Blank', hint: 'Start from nothing', build: function () { return []; } },
  { name: 'Strength', hint: '3 lifts · 5×5 @ 75%', build: function () {
    return [mkBlock(5, 45, 90, [['Squat', 5, 'squat', 75]]),
            mkBlock(5, 45, 90, [['Bench', 5, 'bench', 75]]),
            mkBlock(4, 45, 90, [['Clean', 3, 'clean', 70]])];
  } },
  { name: 'Wave 5/3/1', hint: 'Reps 5/3/1 @ 75/85/95%', build: function () {
    return [mkBlock(3, 60, 120, [['Squat', [5, 3, 1], 'squat', [75, 85, 95]]]),
            mkBlock(3, 60, 120, [['Bench', [5, 3, 1], 'bench', [75, 85, 95]]])];
  } },
  { name: 'Superset', hint: 'Pairs alternate every round', build: function () {
    return [mkBlock(4, 45, 60, [['Bench', 5, 'bench', 70], ['Row', 8]]),
            mkBlock(4, 45, 60, [['Squat', 5, 'squat', 70], ['RDL', 8, 'deadlift', 50]])];
  } },
  { name: 'Straight sets', hint: 'Sequential · finish each lift before the next', mode: 'sequential', build: function () {
    return [mkBlock(4, 45, 75, [['Squat', 5, 'squat', 75], ['Front Squat', 5, 'squat', 55], ['Lunges', 8]])];
  } },
  { name: 'Circuit', hint: 'Station timer · 4 stations', mode: 'station', build: function () {
    return [mkBlock(2, 60, 30, [['Bench + Dips', 8], ['Squat + Lunges', 8], ['Clean + Rows', 6], ['Deadlift + Planks', 6]])];
  } }
];

var templatesOpen = false;

function createWorkout(t) {
  var w = { id: uuid(), name: t.name === 'Blank' ? 'Untitled' : t.name, transitionSec: 60, blocks: t.build() };
  if (t.mode) w.mode = t.mode;
  state.workouts.push(w);
  selectedWorkoutId = w.id;
  templatesOpen = false;
  save();
  renderWorkouts();
  var nm = $('#wo-name');
  if (nm) { nm.focus(); nm.select(); }
}

function renderWorkouts() {
  var root = $('#tab-workouts');
  root.innerHTML = '';

  var rail = el('div', { class: 'wo-rail' });
  rail.append(el('button', {
    class: 'btn primary', 'aria-expanded': templatesOpen ? 'true' : 'false',
    onclick: function () { templatesOpen = !templatesOpen; renderWorkouts(); if (templatesOpen) $('.tpl-row').focus(); }
  }, '+ New workout'));
  if (templatesOpen) {
    rail.append(el('div', { class: 'tpl-panel' },
      el('div', { class: 'tpl-title' }, 'Start from'),
      TEMPLATES.map(function (t) {
        return el('button', { class: 'tpl-row', onclick: function () { createWorkout(t); } },
          el('span', {}, t.name), el('small', {}, t.hint));
      })));
  }

  state.workouts.forEach(function (w) {
    rail.append(el('div', { class: 'wo-row' + (w.id === selectedWorkoutId ? ' is-selected' : '') },
      el('button', {
        class: 'wo-row-name', onclick: function () { selectedWorkoutId = w.id; renderWorkouts(); }
      }, w.name),
      el('button', {
        class: 'copybtn', title: 'Duplicate', 'aria-label': 'Duplicate ' + w.name,
        onclick: function () {
          var c = JSON.parse(JSON.stringify(w));
          c.id = uuid();
          c.name = w.name + ' copy';
          c.blocks.forEach(function (b) { b.id = uuid(); b.exercises.forEach(function (x) { x.id = uuid(); }); });
          state.workouts.splice(state.workouts.indexOf(w) + 1, 0, c);
          selectedWorkoutId = c.id;
          save();
          renderWorkouts();
          var nm = $('#wo-name');
          if (nm) { nm.focus(); nm.select(); }
        }
      }, '⧉'),
      el('button', {
        class: 'trash', 'aria-label': 'Delete ' + w.name,
        onclick: function () {
          if (!confirm('Delete ' + w.name + '?')) return;
          state.workouts = state.workouts.filter(function (x) { return x.id !== w.id; });
          if (selectedWorkoutId === w.id) selectedWorkoutId = null;
          if (pickerSelectedId === w.id) pickerSelectedId = null;
          save();
          renderWorkouts();
        }
      }, '✕')));
  });
  root.append(rail);

  var w = state.workouts.find(function (x) { return x.id === selectedWorkoutId; });
  var editor = el('div', { class: 'wo-editor' });
  if (!w) {
    editor.append(el('div', { class: 'empty-msg' }, 'Select a workout, or create one.'));
    root.append(editor);
    return;
  }

  var nameInput = el('input', {
    id: 'wo-name', type: 'text', value: w.name,
    oninput: function () {
      w.name = nameInput.value;
      save();
      var sel = root.querySelector('.wo-row.is-selected .wo-row-name');
      if (sel) sel.textContent = w.name;
    }
  });
  var transInput = el('input', {
    type: 'number', min: '0', value: w.transitionSec, inputmode: 'numeric',
    onchange: function () {
      var n = parseInt(transInput.value, 10);
      w.transitionSec = (isFinite(n) && n >= 0) ? n : 0;
      save();
      renderWorkouts();
    }
  });
  var mode = workoutMode(w);
  function modeBtn(key, label, title) {
    return el('button', {
      class: mode === key ? 'is-active' : '', title: title,
      onclick: function () { if (key === 'rotational') delete w.mode; else w.mode = key; save(); renderWorkouts(); }
    }, label);
  }
  editor.append(el('div', { class: 'wo-editor-head' },
    nameInput,
    el('label', { class: 'wo-trans' }, 'Transition between blocks: ', transInput, ' sec'),
    el('span', { class: 'wo-trans' }, 'Timer',
      el('span', { class: 'mode-toggle' },
        modeBtn('rotational', 'Rotational', 'Athletes on a rack rotate through the block’s exercises each round — one lifts while the others do the pair. Weights on the TV.'),
        modeBtn('sequential', 'Sequential', 'Everyone does all sets of exercise 1, then all sets of exercise 2, and so on. Weights on the TV.'),
        modeBtn('station', 'Station', 'Rack grid on top, one colored band per exercise (a station) along the bottom with reps per set. Each athlete’s chip is the color of the station they’re at; they rotate one station per round. No weights on screen. Name accessories with +, e.g. "Bench + Dips".'))),
    el('span', { class: 'wo-shift' },
      el('button', { class: 'btn', title: 'Every percentage −5 (next deload)', onclick: function () { shiftPcts(w, -5); } }, '−5%'),
      el('button', { class: 'btn', title: 'Every percentage +5 (next week)', onclick: function () { shiftPcts(w, 5); } }, '+5%'),
      el('button', {
        class: 'btn primary', disabled: !isRunnable(w), title: isRunnable(w) ? 'Run this workout' : 'Add a block with work time first',
        onclick: function () { pickerSelectedId = w.id; openPicker(); }
      }, 'Run ▶'))));

  if (!w.blocks.length) {
    editor.append(el('div', { class: 'wo-hint' },
      'A workout is a list of blocks. Each block has its own sets, work/rest clock and one or more exercises — athletes on a rack rotate through a block’s exercises each round.'));
  }

  w.blocks.forEach(function (b, bi) {
    editor.append(blockCard(w, b, bi));
  });

  editor.append(el('div', { class: 'wo-foot' },
    el('button', {
      class: 'btn', onclick: function () {
        var prev = w.blocks[w.blocks.length - 1];
        var prevEx = prev ? prev.exercises[0] : null;
        w.blocks.push(prev
          ? { id: uuid(), sets: prev.sets, workSec: prev.workSec, restSec: prev.restSec, exercises: [{ id: uuid(), name: '', reps: copyWave(prevEx.reps), maxKey: prevEx.maxKey, pct: copyWave(prevEx.pct) }] }
          : { id: uuid(), sets: 3, workSec: 45, restSec: 90, exercises: [{ id: uuid(), name: '', reps: 5, maxKey: null, pct: null }] });
        save();
        renderWorkouts();
        var cards = document.querySelectorAll('.block-card');
        var last = cards[cards.length - 1];
        if (last) last.querySelector('input[type=text]').focus();
      }
    }, '+ Add block'),
    el('div', { class: 'wo-total' }, 'Total: ', el('b', {}, fmtClockPad(workoutTotalSec(w))))));

  if (w.blocks.length) editor.append(timeline(w));

  root.append(editor);
}

function timeline(w) { // proportional lift/rest/transition strip: the session at a glance
  var phases = buildPhases(w);
  var total = phases.reduce(function (t, p) { return t + p.dur; }, 0);
  var bar = el('div', { class: 'wo-timeline', title: 'Timeline — green lift, red rest, blue transition' });
  if (!total) return bar;
  phases.forEach(function (p) {
    var label = p.type === 'TRANSITION' ? 'Transition ' + fmtClock(p.dur)
      : 'Block ' + (p.blockIndex + 1) + ' · ' + (p.type === 'LIFT' ? 'Lift' : 'Rest') + ' ' + p.set + ' · ' + fmtClock(p.dur);
    bar.append(el('span', { class: 'tl-' + p.type.toLowerCase(), style: { flex: String(p.dur) }, title: label }));
  });
  return bar;
}

function shiftPcts(w, delta) { // week-to-week progression: every %1RM (waves elementwise), clamped like parseList
  w.blocks.forEach(function (b) {
    b.exercises.forEach(function (x) {
      if (x.pct == null) return;
      var bump = function (p) { return Math.max(1, Math.min(150, p + delta)); };
      x.pct = Array.isArray(x.pct) ? x.pct.map(bump) : bump(x.pct);
    });
  });
  save();
  renderWorkouts();
}

function blockCard(w, b, bi) {
  function intField(key, min) {
    var input = el('input', {
      type: 'number', min: String(min), value: b[key], inputmode: 'numeric',
      onchange: function () {
        var n = parseInt(input.value, 10);
        b[key] = (isFinite(n) && n >= min) ? n : min;
        save();
        renderWorkouts();
      }
    });
    return input;
  }

  function moveBtn(dir, label) {
    var target = bi + dir;
    return el('button', {
      class: 'rowbtn', 'aria-label': (dir < 0 ? 'Move up' : 'Move down'),
      disabled: target < 0 || target >= w.blocks.length,
      onclick: function () {
        var tmp = w.blocks[bi];
        w.blocks[bi] = w.blocks[target];
        w.blocks[target] = tmp;
        save();
        renderWorkouts();
      }
    }, label);
  }

  var card = el('div', { class: 'block-card' },
    el('div', { class: 'block-head' },
      el('label', {}, 'Sets ', intField('sets', 1)),
      el('label', {}, 'Work sec ', intField('workSec', 0)),
      el('label', {}, 'Rest sec ', intField('restSec', 0)),
      el('span', { class: 'block-dur', title: 'This block’s clock time' }, fmtClockPad(blockDurSec(b))),
      el('span', { class: 'block-head-btns' },
        moveBtn(-1, '↑'), moveBtn(1, '↓'),
        el('button', {
          class: 'rowbtn', 'aria-label': 'Remove block',
          onclick: function () { w.blocks.splice(bi, 1); save(); renderWorkouts(); }
        }, '✕'))));

  var table = el('table', { class: 'blocks-table' }, el('thead', {}, el('tr', {},
    el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Reps'),
    el('th', { class: 'num' }, '%1RM'), el('th', {}, 'of'), el('th', {}, 'Demo video'), el('th', {}, '')
  )));
  var tbody = el('tbody');
  b.exercises.forEach(function (ex, ei) {
    tbody.append(exerciseRow(w, b, ex, ei));
  });
  table.append(tbody);
  card.append(table);

  card.append(el('button', {
    class: 'btn addex', onclick: function () {
      var prev = b.exercises[b.exercises.length - 1];
      b.exercises.push({ id: uuid(), name: '', reps: copyWave(prev.reps), maxKey: prev.maxKey, pct: copyWave(prev.pct) });
      save();
      renderWorkouts();
      var cards = document.querySelectorAll('.block-card');
      var inputs = cards[bi].querySelectorAll('tbody input[type=text]');
      inputs[inputs.length - 1].focus();
    }
  }, '+ exercise'));

  return card;
}

function exerciseRow(w, b, ex, ei) {
  var nameInput = el('input', {
    type: 'text', value: ex.name, placeholder: 'Exercise',
    onchange: function () { ex.name = nameInput.value.trim(); save(); }
  });

  var repsInput = el('input', {
    type: 'text', class: 'listfield', value: fmtList(ex.reps), title: 'Reps, or a wave like 5/5/3',
    onchange: function () {
      var parsed = parseList(repsInput.value, 1, 99);
      if (parsed != null) ex.reps = parsed; // invalid keeps the old value
      save();
      renderWorkouts();
    }
  });

  // pct + "of" are a pair: both null or both set. pct stays enabled so that
  // entering a pct while "of" is "—" can auto-select Squat (spec'd behavior).
  var pctInput = el('input', {
    type: 'text', class: 'listfield', value: fmtList(ex.pct), title: '%1RM, or a wave like 70/80/90',
    onchange: function () {
      var v = pctInput.value.trim();
      if (v === '') { ex.pct = null; ex.maxKey = null; }
      else {
        var parsed = parseList(v, 1, 150);
        if (parsed != null) {
          ex.pct = parsed;
          if (ex.maxKey == null) ex.maxKey = 'squat';
        }
      }
      save();
      renderWorkouts();
    }
  });

  var ofSelect = el('select', {
    onchange: function () {
      if (ofSelect.value === '') { ex.maxKey = null; ex.pct = null; }
      else {
        ex.maxKey = ofSelect.value;
        if (ex.pct == null) ex.pct = 75;
      }
      save();
      renderWorkouts();
    }
  }, el('option', { value: '' }, '—'),
    MAX_KEYS.map(function (k) { return el('option', { value: k, selected: ex.maxKey === k }, MAX_LABELS[k]); }));

  var videoInput = el('input', {
    type: 'text', class: 'videofield', value: ex.video || '', placeholder: 'Demo video URL',
    title: 'Rotational timer shows this clip in each rack box (YouTube link or a video file). Several exercises with clips take turns each round; one clip loops.',
    onchange: function () { var v = videoInput.value.trim(); if (v) ex.video = v; else delete ex.video; save(); }
  });

  return el('tr', {},
    el('td', {}, nameInput),
    el('td', { class: 'num' }, repsInput),
    el('td', { class: 'num' }, pctInput),
    el('td', {}, ofSelect),
    el('td', {}, videoInput),
    el('td', {},
      el('button', {
        class: 'rowbtn', 'aria-label': 'Remove exercise',
        disabled: b.exercises.length === 1,
        onclick: function () { b.exercises.splice(ei, 1); save(); renderWorkouts(); }
      }, '✕')));
}

/* ================= groups tab ================= */
function statValue(a, stat) {
  return stat === 'total' ? total(a) : (a.maxes[stat] || 0);
}

function regenerate() {
  var g = state.grouping;
  // local clamp only: g.count is a shared setting — never persist a squad-size squeeze
  var count = Math.max(1, Math.min(g.count, maxRacks()));
  var sorted = presentAthletes().sort(function (a, b) {
    return statValue(b, g.stat) - statValue(a, g.stat) || a.name.localeCompare(b.name);
  });
  var asg = {};
  // carry over what this regenerate does NOT own: other squads verbatim,
  // this squad's absentees clamped (they're coming back)
  var mine = {};
  roster().forEach(function (a) { mine[a.id] = true; });
  state.athletes.forEach(function (a) {
    var r = g.assignments[a.id];
    if (r == null) return;
    if (!mine[a.id]) asg[a.id] = r;
    else if (isOut(a)) asg[a.id] = Math.min(r, count - 1);
  });
  if (g.mode === 'similar') {
    var n = sorted.length, base = Math.floor(n / count), extra = n % count, idx = 0;
    for (var r = 0; r < count; r++) {
      var size = base + (r < extra ? 1 : 0);
      for (var k = 0; k < size; k++) asg[sorted[idx++].id] = r;
    }
  } else { // balanced: snake draft
    var pos = 0, dir = 1;
    sorted.forEach(function (a) {
      asg[a.id] = pos;
      pos += dir;
      if (pos === count) { pos = count - 1; dir = -1; }
      else if (pos === -1) { pos = 0; dir = 1; }
    });
  }
  g.assignments = asg;
  save();
  renderGroups();
}

function renderGroups() {
  var root = $('#tab-groups');
  root.innerHTML = '';
  var g = state.grouping;

  if (roster().length === 0) {
    root.append(el('div', { class: 'empty-msg' }, 'Add athletes first — ',
      el('a', { href: '#', onclick: function (e) { e.preventDefault(); showTab('athletes'); } }, 'go to Athletes')));
    return;
  }

  // controls
  var controls = el('div', { class: 'grp-controls' });
  controls.append(el('span', {}, el('label', {}, 'Racks'),
    el('span', { class: 'stepper' },
      el('button', { disabled: g.count <= 1, 'aria-label': 'Fewer racks', onclick: function () { g.count--; save(); renderGroups(); } }, '−'),
      el('span', { class: 'stepper-val' }, String(g.count)),
      el('button', { disabled: g.count >= maxRacks(), 'aria-label': 'More racks', onclick: function () { g.count++; save(); renderGroups(); } }, '+'))));
  controls.append(el('span', { class: 'mode-toggle' },
    el('button', { class: g.mode === 'similar' ? 'is-active' : '', onclick: function () { g.mode = 'similar'; save(); renderGroups(); } }, 'Similar strength'),
    el('button', { class: g.mode === 'balanced' ? 'is-active' : '', onclick: function () { g.mode = 'balanced'; save(); renderGroups(); } }, 'Balanced')));
  var statSel = el('select', {
    onchange: function () { g.stat = statSel.value; save(); renderGroups(); }
  }, el('option', { value: 'total', selected: g.stat === 'total' }, 'Total'),
    MAX_KEYS.map(function (k) { return el('option', { value: k, selected: g.stat === k }, MAX_LABELS[k]); }));
  controls.append(el('span', {}, el('label', {}, 'Rank by'), statSel));
  controls.append(el('button', { class: 'btn primary', onclick: regenerate }, 'Regenerate'));
  var outList = roster().filter(isOut);
  if (outList.length) {
    controls.append(el('button', {
      class: 'btn', title: 'Clear all Out marks',
      onclick: function () { roster().forEach(function (a) { delete a.out; }); save(); renderGroups(); }
    }, 'All in (' + outList.length + ' out)'));
  }
  root.append(controls);

  // bucket athletes (absentees go to their own card)
  var byRack = {}, unassigned = [];
  roster().forEach(function (a) {
    if (isOut(a)) return;
    var r = g.assignments[a.id];
    if (r == null) unassigned.push(a);
    else (byRack[r] = byRack[r] || []).push(a);
  });
  var maxIdx = Object.keys(byRack).reduce(function (m, k) { return Math.max(m, Number(k)); }, -1);
  var cardCount = Math.max(g.count, maxIdx + 1);

  function memberRow(a, rackIdx, mi) {
    var val = g.stat === 'total' ? String(total(a))
      : (a.maxes[g.stat] == null ? '—' : String(a.maxes[g.stat]));
    var sel = el('select', {
      'aria-label': 'Rack for ' + a.name,
      onchange: function () { g.assignments[a.id] = Number(sel.value); save(); renderGroups(); }
    });
    for (var i = 0; i < cardCount; i++) {
      sel.append(el('option', { value: String(i), selected: i === rackIdx }, 'Rack ' + (i + 1)));
    }
    if (rackIdx == null) sel.prepend(el('option', { value: '', selected: true, disabled: true }, '—'));
    return el('div', { class: 'grp-member' },
      el('span', { class: 'gm-name' },
        mi == null ? null : el('span', { class: 'gm-chip', style: { background: plateColor(mi) } }),
        a.name),
      el('span', { class: 'gm-val' }, val), sel,
      el('button', {
        class: 'gm-out', title: 'Out today', 'aria-label': a.name + ' out today',
        onclick: function () { a.out = today(); save(); renderGroups(); }
      }, '–'));
  }

  var cards = el('div', { class: 'grp-cards' });
  for (var r = 0; r < cardCount; r++) {
    var members = (byRack[r] || []).slice().sort(function (a, b) {
      return statValue(b, g.stat) - statValue(a, g.stat) || a.name.localeCompare(b.name);
    });
    var card = el('div', { class: 'grp-card', style: { '--plate': plateColor(r) } },
      el('h3', {}, 'Rack ' + (r + 1), el('small', {}, members.length + (members.length === 1 ? ' athlete' : ' athletes'))));
    members.forEach(function (a, i) { card.append(memberRow(a, r, i)); });
    cards.append(card);
  }
  if (unassigned.length) {
    var uc = el('div', { class: 'grp-card unassigned' },
      el('h3', {}, 'Unassigned'),
      el('div', { class: 'grp-hint' }, 'New athletes — assign manually or Regenerate.'));
    unassigned.forEach(function (a) { uc.append(memberRow(a, null)); });
    cards.append(uc);
  }
  if (outList.length) {
    var oc = el('div', { class: 'grp-card outcard' },
      el('h3', {}, 'Out today', el('small', {}, outList.length + (outList.length === 1 ? ' athlete' : ' athletes'))));
    outList.forEach(function (a) {
      oc.append(el('div', { class: 'grp-member' },
        el('span', { class: 'gm-name' }, a.name),
        el('button', {
          class: 'btn gm-back', onclick: function () { delete a.out; save(); renderGroups(); }
        }, 'Back in')));
    });
    cards.append(oc);
  }
  root.append(cards);
}

/* ================= backup / restore ================= */
function refreshBackupBadge() {
  var btn = $('#backup-btn');
  var days = state.lastBackup ? (Date.now() - state.lastBackup) / 86400000 : Infinity;
  var stale = state.athletes.length > 0 && days > 14;
  btn.classList.toggle('stale', stale);
  btn.title = stale
    ? (state.lastBackup ? 'Last backup ' + Math.floor(days) + ' days ago — save a fresh one'
                        : 'Never backed up — everything lives in this browser')
    : 'Save everything to a file';
}

$('#backup-btn').addEventListener('click', function () {
  state.lastBackup = Date.now();
  save();
  var a = el('a', {
    href: URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' })),
    download: 'rackroom-' + new Date().toISOString().slice(0, 10) + '.json'
  });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

$('#restore-btn').addEventListener('click', function () { $('#restore-file').click(); });

$('#restore-file').addEventListener('change', function () {
  var input = this;
  var f = input.files[0];
  input.value = '';
  if (!f) return;
  f.text().then(function (text) {
    var s;
    try {
      s = parseState(text);
    } catch (e) {
      alert('Not a valid Rack Room backup file.');
      return;
    }
    if (!confirm('Replace current athletes, workouts and groups with this backup?')) return;
    state = s;
    save();
    renderTab(currentTab);
  });
});

/* ================= run picker ================= */
var pickerSelectedId = null;

$('#run-btn').addEventListener('click', openPicker);
$('#picker-cancel').addEventListener('click', closePicker);
$('#picker').addEventListener('click', function (e) { if (e.target.id === 'picker') closePicker(); });
$('#picker-start').addEventListener('click', function () {
  var w = state.workouts.find(function (x) { return x.id === pickerSelectedId; });
  if (w && isRunnable(w)) { closePicker(); startRun(w); }
});

function isRunnable(w) {
  return buildPhases(w).some(function (p) { return p.type === 'LIFT'; });
}

function openPicker() {
  if (!state.workouts.find(function (x) { return x.id === pickerSelectedId; })) pickerSelectedId = null;
  var list = $('#picker-list');
  list.innerHTML = '';
  if (state.workouts.length === 0) {
    list.append(el('div', { class: 'empty-msg' }, 'No workouts yet — build one on the Workouts tab.'));
  }
  state.workouts.forEach(function (w) {
    var runnable = isRunnable(w);
    list.append(el('button', {
      class: 'picker-row' + (w.id === pickerSelectedId ? ' is-selected' : ''),
      disabled: !runnable,
      onclick: function () { pickerSelectedId = w.id; openPicker(); }
    }, el('span', {}, w.name + (runnable ? '' : ' (empty)')),
      el('span', { class: 'pr-dur' }, fmtClockPad(workoutTotalSec(w)),
        el('small', {}, 'ends ' + fmtEnds(workoutTotalSec(w) * 1000)))));
  });
  if (roster().length) {
    var present = presentAthletes();
    var assigned = 0;
    present.forEach(function (a) {
      var r = state.grouping.assignments[a.id];
      if (r != null && r <= 7) assigned++;
    });
    var un = present.length - assigned;
    if (present.length === 0) {
      list.append(el('div', { class: 'picker-warn' }, 'Everyone is marked Out today — the run will show no athletes.'));
    } else if (assigned === 0) {
      list.append(el('div', { class: 'picker-warn' }, 'No rack assignments — the run will show no athletes. Visit Groups and Regenerate first.'));
    } else if (un > 0) {
      list.append(el('div', { class: 'picker-warn' }, un + ' unassigned athlete' + (un === 1 ? '' : 's') + ' will not appear on the run screen.'));
    }
    // preflight: athletes on the board who lack a max the selected workout needs
    var selW = state.workouts.find(function (x) { return x.id === pickerSelectedId; });
    if (selW) {
      var needed = {};
      selW.blocks.forEach(function (b) {
        b.exercises.forEach(function (x) { if (x.maxKey && x.pct != null) needed[x.maxKey] = true; });
      });
      var missing = [];
      present.forEach(function (a) {
        var r = state.grouping.assignments[a.id];
        if (r == null || r > 7) return;
        var lacks = Object.keys(needed).filter(function (k) { return a.maxes[k] == null; });
        if (lacks.length) missing.push(shortName(a.name) + ' (' + lacks.map(function (k) { return MAX_LABELS[k]; }).join(', ') + ')');
      });
      if (missing.length) {
        var shown = missing.slice(0, 4).join(', ') + (missing.length > 4 ? ' +' + (missing.length - 4) + ' more' : '');
        list.append(el('div', { class: 'picker-warn' }, 'Missing maxes — reps only on the TV: ' + shown));
      }
    }
  } else {
    list.append(el('div', { class: 'picker-warn' },
      (state.athletes.length ? 'No athletes on this squad' : 'No athletes yet') + ' — the run will show no athletes.'));
  }
  var sel = state.workouts.find(function (x) { return x.id === pickerSelectedId; });
  $('#picker-start').disabled = !(sel && isRunnable(sel));
  $('#picker-print').disabled = $('#picker-start').disabled;
  $('#picker').hidden = false;
  var ft = list.querySelector('.picker-row.is-selected') || $('#picker-cancel');
  ft.focus();
}

function closePicker() {
  $('#picker').hidden = true;
  $('#run-btn').focus();
}

/* ================= print sheets ================= */
function printCell(exx, m, sets) {
  var max = exx.maxKey ? m.maxes[exx.maxKey] : null;
  if (exx.pct == null || !exx.maxKey || max == null) return '×' + fmtList(exx.reps);
  var ws = [];
  for (var s = 1; s <= sets; s++) ws.push(workingWeight(forSet(exx.pct, s), max));
  var allSame = ws.every(function (v) { return v === ws[0]; });
  if (allSame) {
    var pl = ws[0] >= 45 ? platesPerSide(ws[0]) : null;
    return String(ws[0]) + (pl ? ' (' + (pl.length ? pl.join('·') : 'bar') + ')' : '');
  }
  return ws.join(' · '); // one weight per set, in order
}

function renderPrint(w) {
  var root = $('#print');
  root.innerHTML = '';
  var planMap = {};
  state.workouts.forEach(function (x) { planMap[x.id] = x; });
  root.append(el('div', { class: 'pr-head' },
    el('h1', {}, w.name),
    el('div', {}, (state.activeSquad ? state.activeSquad + ' · ' : '') + today()
      + ' · ' + fmtClockPad(workoutTotalSec(w)) + ' total')));
  snapshotRacks().forEach(function (rack) {
    var sec = el('div', { class: 'pr-rack' }, el('h2', {}, 'RACK ' + (rack.idx + 1)));
    w.blocks.forEach(function (b, bi) {
      sec.append(el('h3', {}, 'BLOCK ' + (bi + 1) + ' · ' + b.sets + ' SET' + (b.sets === 1 ? '' : 'S')
        + ' · WORK ' + fmtClock(b.workSec) + ' / REST ' + fmtClock(b.restSec)));
      var table = el('table', {}, el('thead', {}, el('tr', {},
        el('th', {}, ''),
        b.exercises.map(function (x) {
          return el('th', {}, (x.name || 'Exercise') + ' — ' + fmtList(x.reps) + ' reps'
            + (x.pct != null ? ' @ ' + fmtList(x.pct) + '%' : ''));
        }))));
      var tb = el('tbody');
      rack.members.forEach(function (m) {
        var pw = m.workoutId && planMap[m.workoutId];
        var pb = pw && pw.blocks[bi];
        var eb = (pb && pb.exercises.length) ? pb : b;
        if (eb === b) {
          tb.append(el('tr', {},
            el('td', {}, shortName(m.name)),
            b.exercises.map(function (x) { return el('td', {}, printCell(x, m, b.sets)); })));
        } else { // personal plan: their own exercises on one line
          tb.append(el('tr', { class: 'pr-plan' },
            el('td', {}, shortName(m.name) + ' (' + pw.name + ')'),
            el('td', { colspan: String(b.exercises.length) },
              eb.exercises.map(function (x) { return (x.name || 'Exercise') + ' ' + printCell(x, m, b.sets); }).join('  ·  '))));
        }
      });
      table.append(tb);
      sec.append(table);
    });
    root.append(sec);
  });
}

$('#picker-print').addEventListener('click', function () {
  var w = state.workouts.find(function (x) { return x.id === pickerSelectedId; });
  if (!w || !isRunnable(w)) return;
  renderPrint(w);
  document.body.classList.add('printing'); // gate: a plain Ctrl+P must never print stale sheets
  addEventListener('afterprint', function () { document.body.classList.remove('printing'); }, { once: true });
  window.print();
});

/* ================= run: phases + snapshot ================= */
function buildPhases(w) {
  var phases = [];
  w.blocks.forEach(function (b, bi) {
    var rounds = b.sets * b.exercises.length;
    for (var s = 1; s <= rounds; s++) {
      if (b.workSec > 0) phases.push({ type: 'LIFT', blockIndex: bi, set: s, dur: b.workSec });
      if (s < rounds && b.restSec > 0) phases.push({ type: 'REST', blockIndex: bi, set: s, dur: b.restSec });
    }
    if (bi < w.blocks.length - 1 && w.transitionSec > 0) phases.push({ type: 'TRANSITION', blockIndex: bi, dur: w.transitionSec });
  });
  return phases;
}

function snapshotRacks() {
  var byRack = {};
  roster().forEach(function (a) {
    var r = state.grouping.assignments[a.id];
    if (isOut(a) || r == null || r > 7) return;
    (byRack[r] = byRack[r] || []).push({ id: a.id, name: a.name, workoutId: a.workoutId, maxes: Object.assign({}, a.maxes) });
  });
  // same order as the Groups tab so each athlete's designated color matches everywhere
  var stat = state.grouping.stat;
  return Object.keys(byRack).map(Number).sort(function (a, b) { return a - b; })
    .map(function (idx) {
      var members = byRack[idx].sort(function (a, b) {
        return statValue(b, stat) - statValue(a, stat) || a.name.localeCompare(b.name);
      });
      // stable rotation slot: array order can change mid-run (pause-roster edits)
      members.forEach(function (m, i) { m.slot = i; });
      return { idx: idx, members: members };
    });
}

/* ================= run: state machine ================= */
var run = null;
var audioCtx = null;
var wakeLock = null;
var cursorTimer = null;

function tone(freq, ms, at) {
  if (!audioCtx) return;
  try {
    var o = audioCtx.createOscillator();
    var gn = audioCtx.createGain();
    o.type = 'square'; // cuts through room noise better than sine
    o.frequency.value = freq;
    o.connect(gn);
    gn.connect(audioCtx.destination);
    var t = audioCtx.currentTime + (at || 0);
    gn.gain.setValueAtTime(0.3, t);
    gn.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
    o.start(t);
    o.stop(t + ms / 1000);
  } catch (e) { /* audio unavailable */ }
}

function beep(freq, ms) { tone(freq, ms, 0); }

// distinct per-phase signatures so athletes know lift/rest without seeing the screen
function cue(type) {
  if (type === 'LIFT') { tone(440, 140, 0); tone(660, 320, 0.15); }          // rising: go
  else if (type === 'REST') { tone(330, 180, 0); tone(220, 380, 0.2); }      // falling: rack it
  else if (type === 'TRANSITION') { tone(523, 120, 0); tone(523, 120, 0.18); tone(523, 120, 0.36); } // 3 pips: move
  else { tone(440, 500, 0); tone(660, 600, 0.55); }                          // DONE
}

function acquireWakeLock() {
  if (!navigator.wakeLock) return;
  navigator.wakeLock.request('screen').then(function (wl) { wakeLock = wl; }).catch(function () { });
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(function () { }); wakeLock = null; }
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && run && run.status !== 'done') {
    acquireWakeLock();
    if (audioCtx) audioCtx.resume(); // context can come back suspended -> silent beeps
  }
});

function startRun(w) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch (e) { audioCtx = null; }

  var workout = JSON.parse(JSON.stringify(w)); // snapshot
  var plans = {}; // per-athlete personal workouts, frozen like the master
  state.workouts.forEach(function (x) { plans[x.id] = JSON.parse(JSON.stringify(x)); });
  run = {
    workout: workout,
    plans: plans,
    phases: buildPhases(workout),
    racks: snapshotRacks(),
    i: 0,
    status: 'running',
    phaseEndsAt: 0,
    pausedRemaining: 0,
    lastBeeped: null,
    startedAt: Date.now(),
    pausedTotal: 0,
    pauseStart: 0,
    timerId: 0
  };
  run.phaseEndsAt = Date.now() + run.phases[0].dur * 1000;
  var cum = 0;
  run.phases.forEach(function (p) { p.startSec = cum; cum += p.dur; });
  run.totalSec = cum;

  $('#shell').hidden = true;
  $('#run').hidden = false;
  $('#rr-overlay').hidden = true;
  $('#rr-exit').hidden = true;
  $('#rr-timer').hidden = false;
  $('#rr-grid').hidden = false;
  $('#rr-pausebtn').hidden = false;
  $('#rr-plus30').hidden = false;
  $('#rr-minus30').hidden = false;
  $('#rr-pausebtn').innerHTML = '&#10074;&#10074;';
  $('#rr-setline').classList.remove('done-time');

  cue(run.phases[0].type);
  acquireWakeLock();
  renderRunPhase();
  tick();
  run.timerId = setInterval(tick, 200);
  resetCursorTimer();
}

function currentOrNextLift() {
  for (var j = run.i; j < run.phases.length; j++) {
    if (run.phases[j].type === 'LIFT') return run.phases[j];
  }
  return null;
}

function nextLiftAfter() {
  for (var j = run.i + 1; j < run.phases.length; j++) {
    if (run.phases[j].type === 'LIFT') return run.phases[j];
  }
  return null;
}

function elapsedSec() {
  var p = run.phases[run.i];
  var rem = run.status === 'paused' ? run.pausedRemaining : run.phaseEndsAt - Date.now();
  return p.startSec + p.dur - Math.max(0, rem / 1000);
}

function fmtEnds(msFromNow) { // wall-clock finish time, e.g. "10:59 AM"
  return new Date(Date.now() + msFromNow).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function updateProgress() { // time-based fill + session time left + projected end
  if (!run || run.status === 'done') return;
  var e = elapsedSec();
  $('#rr-progress-fill').style.width = Math.min(100, e / run.totalSec * 100) + '%';
  var remain = Math.max(0, Math.round(run.totalSec - e));
  $('#rr-left').textContent = fmtClockPad(remain) + ' LEFT · ENDS ' + fmtEnds(remain * 1000);
}

function tick() {
  if (!run || run.status !== 'running') return;
  var remaining = run.phaseEndsAt - Date.now();
  if (remaining <= 0) { advance(); return; }
  var sec = Math.ceil(remaining / 1000);
  $('#rr-timer').textContent = fmtClock(sec);
  updateStationClock(remaining);
  updateProgress();
  if (sec <= 3 && sec >= 1 && run.lastBeeped !== sec) {
    run.lastBeeped = sec;
    beep(880, 150);
    var t = $('#rr-timer');
    t.classList.remove('pulse');
    void t.offsetWidth; // restart animation
    t.classList.add('pulse');
  }
}

function advance(manual) {
  run.i++;
  if (run.i >= run.phases.length) { finish(); return; }
  run.lastBeeped = null;
  var dur = run.phases[run.i].dur * 1000;
  if (run.status === 'paused') run.pausedRemaining = dur;
  else if (manual) { run.phaseEndsAt = Date.now() + dur; cue(run.phases[run.i].type); }
  else {
    // chain from the old deadline so overshoot carries; skip phases missed while hidden/suspended
    run.phaseEndsAt += dur;
    while (run.phaseEndsAt <= Date.now()) {
      run.i++;
      if (run.i >= run.phases.length) { finish(); return; }
      run.phaseEndsAt += run.phases[run.i].dur * 1000;
    }
    cue(run.phases[run.i].type);
  }
  renderRunPhase();
  renderTimerNow();
}

function nudge(sec) { // stretch or shrink the CURRENT phase; progress bar and ENDS follow
  if (!run || run.status === 'done') return;
  var ms = sec * 1000;
  if (run.status === 'paused') {
    if (run.pausedRemaining + ms < 5000) ms = Math.min(0, 5000 - run.pausedRemaining); // clamp the cut, never add
    run.pausedRemaining += ms;
  } else {
    var rem = run.phaseEndsAt - Date.now();
    if (rem + ms < 5000) ms = Math.min(0, 5000 - rem);
    run.phaseEndsAt += ms;
  }
  var addSec = ms / 1000;
  run.phases[run.i].dur += addSec;
  for (var j = run.i + 1; j < run.phases.length; j++) run.phases[j].startSec += addSec;
  run.totalSec += addSec;
  run.lastBeeped = null;
  renderTimerNow();
}

function goBack() {
  var p = run.phases[run.i];
  var rem = run.status === 'paused' ? run.pausedRemaining : run.phaseEndsAt - Date.now();
  var elapsed = p.dur * 1000 - rem;
  if (elapsed <= 2000 && run.i > 0) run.i--;
  run.lastBeeped = null;
  var dur = run.phases[run.i].dur * 1000;
  if (run.status === 'paused') run.pausedRemaining = dur;
  else { run.phaseEndsAt = Date.now() + dur; cue(run.phases[run.i].type); }
  renderRunPhase();
  renderTimerNow();
}

function renderTimerNow() {
  if (run.status === 'done') return;
  var rem = run.status === 'paused' ? run.pausedRemaining : run.phaseEndsAt - Date.now();
  $('#rr-timer').textContent = fmtClock(Math.max(0, Math.ceil(rem / 1000)));
  $('#rr-timer').classList.remove('pulse');
  updateStationClock(Math.max(0, rem));
  updateProgress();
}

function pauseRun() {
  if (run.status !== 'running') return;
  run.pausedRemaining = run.phaseEndsAt - Date.now();
  run.pauseStart = Date.now();
  run.status = 'paused';
  renderPauseRoster();
  $('#rr-overlay').hidden = false;
  $('#rr-pausebtn').innerHTML = '&#9654;';
}

/* pause-screen roster fixes: add a late arrival, pull an injured athlete — no restart */
function renderPauseRoster() {
  var box = $('#rr-roster');
  box.innerHTML = '';
  if (!run || run.status === 'done' || !run.racks.length) return;
  var inRun = {};
  run.racks.forEach(function (r) { r.members.forEach(function (m) { if (m.id) inRun[m.id] = true; }); });
  roster().forEach(function (a) {
    if (inRun[a.id]) return;
    var sel = el('select', {});
    run.racks.forEach(function (r) { sel.append(el('option', { value: String(r.idx) }, 'Rack ' + (r.idx + 1))); });
    var sug = state.grouping.assignments[a.id];
    if (sug != null && run.racks.some(function (r) { return r.idx === sug; })) sel.value = String(sug);
    box.append(el('div', { class: 'rro-row' },
      el('span', { class: 'rro-name' }, a.name + (isOut(a) ? ' (out)' : '')),
      sel,
      el('button', { class: 'btn rro-add', onclick: function () { addLate(a, Number(sel.value)); } }, 'Add')));
  });
  run.racks.forEach(function (r) {
    r.members.forEach(function (m) {
      box.append(el('div', { class: 'rro-row dim' },
        el('span', { class: 'rro-name' }, shortName(m.name) + ' — Rack ' + (r.idx + 1)),
        el('button', {
          class: 'rro-del', title: 'Remove from this run', 'aria-label': 'Remove ' + m.name + ' from this run',
          onclick: function () { removeFromRun(r, m); }
        }, '–')));
    });
  });
}

function addLate(a, rackIdx) {
  delete a.out;
  state.grouping.assignments[a.id] = rackIdx;
  save();
  var rack = run.racks.find(function (r) { return r.idx === rackIdx; });
  if (!rack) return;
  var m = { id: a.id, name: a.name, workoutId: a.workoutId, maxes: Object.assign({}, a.maxes) };
  m.slot = rack.members.reduce(function (n, x) { return Math.max(n, x.slot); }, -1) + 1; // fresh station, nobody else shifts
  var stat = state.grouping.stat;
  var i = rack.members.findIndex(function (x) {
    return statValue(x, stat) < statValue(m, stat)
      || (statValue(x, stat) === statValue(m, stat) && x.name.localeCompare(m.name) > 0);
  });
  rack.members.splice(i < 0 ? rack.members.length : i, 0, m);
  renderPauseRoster();
  renderRunPhase();
}

function removeFromRun(rack, m) { // this run only — roster and assignment stay
  var i = rack.members.indexOf(m);
  if (i >= 0) rack.members.splice(i, 1);
  renderPauseRoster();
  renderRunPhase();
}

function resumeRun() {
  if (run.status !== 'paused') return;
  run.pausedTotal += Date.now() - run.pauseStart;
  run.phaseEndsAt = Date.now() + run.pausedRemaining;
  run.status = 'running';
  $('#rr-overlay').hidden = true;
  $('#rr-pausebtn').innerHTML = '&#10074;&#10074;';
}

function finish() {
  if (run.status === 'paused') run.pausedTotal += Date.now() - run.pauseStart;
  run.status = 'done';
  clearInterval(run.timerId);
  cue('DONE');
  releaseWakeLock();

  var elapsed = Math.max(0, Math.round((Date.now() - run.startedAt - run.pausedTotal) / 1000));
  clearTimeout(cursorTimer); // done screen has an Exit button; keep the pointer visible
  var runEl = $('#run');
  runEl.className = 'phase-done';
  $('#rr-progress-fill').style.width = '100%';
  $('#rr-left').textContent = '';
  $('#rr-title').textContent = run.workout.name;
  $('#rr-phaseword').textContent = '';
  $('#rr-exercise').textContent = 'WORKOUT COMPLETE';
  $('#rr-exercise').style.fontSize = '';
  $('#rr-exercise').classList.remove('wrap2');
  $('#rr-setline').textContent = 'Total time ' + fmtClock(elapsed);
  $('#rr-setline').classList.add('done-time');
  $('#rr-timer').hidden = true;
  $('#rr-loadstrip').hidden = true;
  $('#rr-grid').hidden = true;
  $('#rr-stations').hidden = true;
  $('#rr-rot').hidden = true;
  $('#rr-overlay').hidden = true;
  $('#rr-pausebtn').hidden = true;
  $('#rr-plus30').hidden = true;
  $('#rr-minus30').hidden = true;
  $('#rr-exit').hidden = false;
  $('#rr-exit').focus();
}

function exitRun() {
  // a live session is bigger than anything else confirm() guards; the done screen exits freely
  if (run.status !== 'done' && !confirm('End this workout? The session clock and any mid-run changes are lost.')) return;
  clearInterval(run.timerId);
  releaseWakeLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(function () { });
  run = null;
  clearTimeout(cursorTimer);
  $('#run').hidden = true;
  $('#shell').hidden = false;
  renderTab(currentTab);
}

/* ================= run: rendering ================= */
function renderRunPhase() {
  var p = run.phases[run.i];
  var w = run.workout;
  var runEl = $('#run');
  runEl.className = 'phase-' + p.type.toLowerCase() + (runEl.classList.contains('nocursor') ? ' nocursor' : '');

  updateProgress();

  var lift = currentOrNextLift();
  var dispBlockIndex = lift ? lift.blockIndex : p.blockIndex;
  var dispBlock = w.blocks[dispBlockIndex];

  $('#rr-title').textContent = w.name + '  ·  BLOCK ' + (dispBlockIndex + 1) + ' OF ' + w.blocks.length
    + '  ·  WORK ' + fmtClock(dispBlock.workSec) + ' / REST ' + fmtClock(dispBlock.restSec);

  var word, exText, set, roundIdx;
  var previewNext = false;
  if (p.type === 'LIFT') {
    word = 'LIFT';
    exText = exNames(dispBlock);
    set = p.set;
    roundIdx = p.set - 1;
  } else {
    word = p.type === 'REST' ? 'REST' : 'TRANSITION — GO TO YOUR RACK';
    var nl = nextLiftAfter();
    previewNext = !!nl; // no lift ahead (trailing cool-down rest) -> nothing to preview
    var nb = nl ? w.blocks[nl.blockIndex] : dispBlock;
    exText = nl ? 'NEXT: ' + exNames(nb) : exNames(nb);
    // rest/transition preview the NEXT lift's round: athletes see where they
    // rotate to and what to load while they still have time to do it
    roundIdx = nl ? nl.set - 1 : 0;
    set = nl ? nl.set : 1;
    if (nl) { dispBlockIndex = nl.blockIndex; dispBlock = nb; }
  }
  $('#rr-phaseword').textContent = word;

  var E = dispBlock.exercises.length;
  var seq = workoutMode(w) === 'sequential' && E > 1;
  var setline;
  if (seq) { // one exercise at a time: name it, count its own sets
    var sx = dispBlock.exercises[seqExIndex(dispBlock, roundIdx)];
    var ss = roundIdx % dispBlock.sets + 1;
    exText = (p.type === 'LIFT' ? '' : 'NEXT: ') + (sx.name || 'Exercise');
    setline = (ss === dispBlock.sets ? 'LAST SET' : 'SET ' + ss + ' OF ' + dispBlock.sets) + ' · ' + forSet(sx.reps, ss) + ' REPS';
  } else {
    setline = E === 1
      ? (set === dispBlock.sets ? 'LAST SET' : 'SET ' + set + ' OF ' + dispBlock.sets) + ' · ' + forSet(dispBlock.exercises[0].reps, set) + ' REPS'
      : (set === dispBlock.sets * E ? 'LAST ROUND' : 'ROUND ' + set + ' OF ' + (dispBlock.sets * E));
  }

  var ex = $('#rr-exercise');
  ex.style.fontSize = '';
  ex.textContent = exText;
  fitText(ex);
  $('#rr-setline').textContent = setline;

  var stationMode = workoutMode(w) === 'station';
  var rotMode = workoutMode(w) === 'rotational'; // boxes around a ring clock: one per exercise, or per rack when there's one exercise
  runEl.classList.toggle('station-mode', stationMode);
  runEl.classList.toggle('rot-mode', rotMode);
  if ((stationMode || rotMode) && E > 1) { // boxes count each exercise's own sets, not rounds
    var stSet = Math.floor(roundIdx / E) + 1;
    setline = stSet === dispBlock.sets ? 'LAST SET' : 'SET ' + stSet + ' OF ' + dispBlock.sets;
  }

  var strip = $('#rr-loadstrip');
  if (p.type === 'TRANSITION' && !stationMode && !rotMode) { // station mode has no weights on screen to load from; the boxes show plates
    strip.hidden = false;
    var loadFor = (E === 1 || seq) ? (dispBlock.exercises[seq ? seqExIndex(dispBlock, roundIdx) : 0].name || 'NEXT BLOCK') : exNames(dispBlock);
    strip.textContent = 'LOAD FOR ' + loadFor.toUpperCase() + ': weights below';
  } else {
    strip.hidden = true;
  }

  $('#rr-grid').hidden = stationMode || rotMode;
  $('#rr-stations').hidden = !stationMode;
  $('#rr-rot').hidden = !rotMode;
  var shortWord = p.type === 'TRANSITION' ? 'TRANSITION' : word;
  var setWord = (previewNext && p.type !== 'TRANSITION' ? 'NEXT · ' : '') + setline;
  if (stationMode) {
    $('#rr-st-phase').textContent = shortWord;
    $('#rr-st-set').textContent = setWord;
    renderStations(dispBlock, roundIdx, previewNext);
  } else if (rotMode) {
    $('#rr-rot-set').textContent = setWord;
    $('#rr-rot-phase').textContent = shortWord;
    renderRot(dispBlock, dispBlockIndex, roundIdx, previewNext, p.type !== 'LIFT');
  } else {
    renderRunGrid(dispBlock, dispBlockIndex, roundIdx, previewNext);
  }
}

/* station mode: stations = the block's exercise list, one colored band each along the
   bottom. Athletes on a rack rotate one station per round; the chip by each name is
   the color of the station they're at. "Bench + Dips" in a name = main lift + accessories. */
function splitStationName(name) {
  var parts = (name || 'Exercise').split('+').map(function (s) { return s.trim(); }).filter(Boolean);
  return parts.length ? parts : ['Exercise'];
}

function inkOn(i) { return i % PLATE_COLORS.length === 2 ? '#141414' : '#fff'; } // yellow needs dark text

function renderStations(block, roundIdx, preview) {
  var E = block.exercises.length;

  var rg = $('#rr-st-racks');
  rg.innerHTML = '';
  var n = run.racks.length;
  var cols = n <= 4 ? Math.max(1, n) : 4;
  rg.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
  rg.classList.toggle('rows-2', n > 4);
  run.racks.forEach(function (rack) {
    var list = el('div', { class: 'st-names' + (rack.members.length > 5 ? ' crowded' : '') });
    rack.members.forEach(function (m) {
      var s = (m.slot + roundIdx) % E;
      list.append(el('div', { class: 'st-name' },
        el('span', { class: 'st-chip', style: { background: plateColor(s) } }), shortName(m.name)));
    });
    rg.append(el('div', { class: 'st-rack' }, el('div', { class: 'st-num' }, String(rack.idx + 1)), list));
  });

  var box = $('#rr-station-cards');
  box.innerHTML = '';
  box.style.gridTemplateColumns = 'repeat(' + E + ',1fr)';
  var curSet = Math.floor(roundIdx / E) + 1;
  block.exercises.forEach(function (exx, s) {
    var names = splitStationName(exx.name);
    var reps = el('div', { class: 'st-reps' });
    for (var k = 1; k <= block.sets; k++) {
      reps.append(el('span', { class: 'st-rep' + (k === curSet ? ' is-cur' : '') }, String(forSet(exx.reps, k))));
    }
    box.append(el('div', { class: 'st-card', style: { '--st-col': plateColor(s), '--st-ink': inkOn(s) } },
      el('div', { class: 'st-lift' }, names[0]),
      names.length > 1 ? el('div', { class: 'st-acc' }, names.slice(1).join(' · ')) : null,
      reps));
  });
}

function updateStationClock(remMs) { // the station bar clock and the rotational ring; no-op for the big timer
  if (!run || run.status === 'done') return;
  var clock = fmtClock(Math.max(0, Math.ceil(remMs / 1000)));
  var mode = workoutMode(run.workout);
  if (mode === 'station') $('#rr-st-time').textContent = clock;
  else if (mode === 'rotational') $('#rr-rot-time').textContent = clock;
}

/* rotational, multi-exercise block: one box per exercise with the athletes on it this
   round (chip = their rack's color) and their working weight; ring clock in the middle */
function loadCell(exx, m, sn, preview) { // weight×reps, or plates during a preview
  var max = exx.maxKey ? m.maxes[exx.maxKey] : null;
  var reps = forSet(exx.reps, sn);
  if (exx.pct != null && exx.maxKey && max != null) {
    var wnum = workingWeight(forSet(exx.pct, sn), max);
    var pl = preview && wnum >= 45 ? platesPerSide(wnum) : null;
    return el('span', { class: 'rack-wt' }, String(wnum),
      pl ? el('span', { class: 'rack-plates' }, pl.length ? pl.join('·') : 'BAR')
         : el('small', {}, '×' + reps));
  }
  return el('span', { class: 'rack-wt' }, '×' + reps);
}

/* rotational: one box per rack. Inside, the block's exercises stacked as rows — name,
   %1RM, reps per set with the current set boxed, and the athletes on that row this
   round (chips rotate one row per round) — plus a REST row and a demo video panel. */
function videoEl(url) {
  var yt = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/.exec(url);
  if (yt) return el('iframe', { src: 'https://www.youtube.com/embed/' + yt[1] + '?autoplay=1&mute=1&loop=1&controls=0&playlist=' + yt[1], allow: 'autoplay', frameborder: '0' });
  var v = el('video', { src: url, autoplay: true, loop: true, playsinline: true });
  v.muted = true; // attribute alone doesn't satisfy autoplay policy in every browser
  return v;
}

function chipLoad(exx, m, sn, preview) { // working weight, or plates during a preview; null when there's no max
  var max = exx.maxKey ? m.maxes[exx.maxKey] : null;
  if (exx.pct == null || !exx.maxKey || max == null) return null;
  var w = workingWeight(forSet(exx.pct, sn), max);
  var pl = preview && w >= 45 ? platesPerSide(w) : null;
  return el('b', { class: 'rot-wt' }, String(w), pl ? el('small', {}, pl.length ? pl.join('·') : 'BAR') : null);
}

function renderRot(block, blockIndex, roundIdx, preview, resting) {
  var box = $('#rr-rot-cards');
  box.innerHTML = '';
  var racks = run.racks, n = racks.length;
  var E = block.exercises.length;
  var twoRows = n > 2;
  var cols = twoRows ? Math.ceil(n / 2) : n;
  box.style.gridTemplateColumns = 'repeat(' + Math.max(1, cols) + ',1fr)';
  box.style.gridTemplateRows = 'repeat(' + (twoRows ? 2 : 1) + ',1fr)';
  var sn = E === 1 ? roundIdx + 1 : Math.floor(roundIdx / E) + 1;
  var vids = block.exercises.filter(function (x) { return x.video; });
  var vid = vids.length ? vids[roundIdx % vids.length] : null; // cycles each round; a single video loops
  run.videoEls = run.videoEls || {};

  function exRow(exx, s, list) {
    var pips = el('div', { class: 'rot-reps' });
    for (var k = 1; k <= block.sets; k++) pips.append(el('span', { class: 'rot-rep' + (k === sn ? ' is-cur' : '') }, String(forSet(exx.reps, k))));
    return el('div', { class: 'rot-ex' + (list.length ? ' has-ath' : ''), style: { '--st-col': plateColor(s) } },
      el('div', { class: 'rot-ex-top' },
        el('span', { class: 'rot-ex-name' }, exx.name || 'Exercise'),
        exx.pct != null && exx.maxKey ? el('span', { class: 'rot-ex-pct' }, fmtList(exx.pct) + '% ' + MAX_LABELS[exx.maxKey]) : null,
        pips),
      el('div', { class: 'rot-ath' }, list.map(function (it) {
        return el('span', { class: 'rot-chip' },
          el('span', { class: 'rack-chip', style: { background: plateColor(it[1]) } }),
          shortName(it[0].name), chipLoad(exx, it[0], sn, preview));
      })));
  }

  racks.forEach(function (rack) {
    var groups = {}, extra = [];
    rack.members.forEach(function (m, i) {
      var pw = m.workoutId && run.plans[m.workoutId];
      var pb = pw && pw.blocks[blockIndex];
      var eb = (pb && pb.exercises.length) ? pb : block;
      var exx = eb.exercises[(m.slot + roundIdx) % eb.exercises.length];
      (groups[exx.id] = groups[exx.id] || []).push([m, i]);
      // a personal plan's exercise gets its own row under the master's
      if (eb !== block && extra.indexOf(exx) < 0 && !block.exercises.some(function (x) { return x.id === exx.id; })) extra.push(exx);
    });
    var rows = el('div', { class: 'rot-rows' });
    block.exercises.concat(extra).forEach(function (exx, s) { rows.append(exRow(exx, s, groups[exx.id] || [])); });
    rows.append(el('div', { class: 'rot-ex rot-rest' + (resting ? ' is-on' : '') }, el('div', { class: 'rot-ex-top' }, el('span', { class: 'rot-ex-name' }, 'REST'))));
    var body = el('div', { class: 'rot-body' }, rows);
    if (vid) { // keep the element across re-renders so the clip doesn't restart every phase
      var ve = run.videoEls[rack.idx];
      if (!ve || ve.dataset.src !== vid.video) { ve = videoEl(vid.video); ve.dataset.src = vid.video; run.videoEls[rack.idx] = ve; }
      body.append(el('div', { class: 'rot-video' }, ve, el('div', { class: 'rot-video-cap' }, vid.name || 'Demo')));
    }
    var card = el('div', { class: 'rot-card' + (rack.members.length > 4 ? ' crowded' : '') + (E + extra.length >= 4 ? ' dense' : '') },
      el('div', { class: 'rack-head', style: { '--plate-col': plateColor(rack.idx) } }, 'RACK ' + (rack.idx + 1)), body);
    box.append(card);
  });
}

function exNames(block) {
  return block.exercises.map(function (x) { return x.name || 'Exercise'; }).join(' / ');
}

function fitText(node) {
  node.classList.remove('wrap2');
  var size = parseFloat(getComputedStyle(node).fontSize);
  while (node.scrollWidth > node.clientWidth && size > 64) {
    size -= 4;
    node.style.fontSize = size + 'px';
  }
  // still too wide at the floor: wrap to two clamped lines instead of shrinking further
  if (node.scrollWidth > node.clientWidth) node.classList.add('wrap2');
}

function renderRunGrid(block, blockIndex, roundIdx, preview) {
  var grid = $('#rr-grid');
  grid.innerHTML = '';
  var racks = run.racks;
  var n = racks.length;
  var twoRows = n > 4;
  grid.className = twoRows ? 'rows-2' : 'rows-1'; // set even when empty: :has(.rows-1) gates the big lift clock
  if (n === 0) return;

  var cols = twoRows ? Math.ceil(n / 2) : n;
  grid.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
  var tier = twoRows ? 'tier-b' : 'tier-a';
  var tierRows = twoRows ? 3 : 6;

  // flash the exercise groups only when the rotation actually changed (new round, same block)
  var swapped = run.lastGrid && run.lastGrid.block === block && run.lastGrid.round !== roundIdx;
  run.lastGrid = { block: block, round: roundIdx };

  function rackRow(exx, m, mi, sn) {
    return el('div', { class: 'rack-row' },
      el('span', { class: 'rack-name' },
        el('span', { class: 'rack-chip', style: { background: plateColor(mi) } }),
        shortName(m.name)),
      loadCell(exx, m, sn, preview));
  }

  // sequential: everyone is on the same exercise, counting that exercise's own sets;
  // rotational: a single-exercise block counts sets, a multi-exercise one counts rounds
  var seq = workoutMode(run.workout) === 'sequential';
  function setNumFor(E) {
    if (seq) return roundIdx % block.sets + 1;
    return E === 1 ? roundIdx + 1 : Math.floor(roundIdx / E) + 1;
  }

  racks.forEach(function (rack) {
    // resolve each member's exercise this round: their personal plan's block if they
    // have one (falling back to the master block), rotated on that block's exercises
    var groups = [], byId = {};
    rack.members.forEach(function (m, i) {
      var pw = m.workoutId && run.plans[m.workoutId];
      var pb = pw && pw.blocks[blockIndex];
      var eb = (pb && pb.exercises.length) ? pb : block;
      var exx = seq
        ? eb.exercises[Math.min(seqExIndex(block, roundIdx), eb.exercises.length - 1)] // plan blocks pace off the master's sets
        : eb.exercises[(m.slot + roundIdx) % eb.exercises.length];
      var g = byId[exx.id];
      if (!g) { g = { exx: exx, eb: eb, list: [] }; byId[exx.id] = g; groups.push(g); }
      g.list.push([m, i]);
    });
    // one shared exercise on the master block needs no per-group label (the stage names it)
    var uniform = groups.length === 1 && groups[0].eb === block && (block.exercises.length === 1 || seq);

    var card;
    if (uniform) {
      var sn = setNumFor(block.exercises.length);
      var perColRows = tierRows;
      var athleteCols = Math.max(twoRows ? 2 : 1, Math.ceil(rack.members.length / perColRows));
      // overflow: more athletes than tier capacity -> extra columns, smaller names (weight floor 30px)
      var crowded = rack.members.length > (twoRows ? 6 : 6);
      if (crowded) {
        perColRows = Math.ceil(rack.members.length / athleteCols);
      }
      card = el('div', { class: 'rack-card ' + tier + (crowded ? ' crowded' : '') },
        el('div', { class: 'rack-head', style: { '--plate-col': plateColor(rack.idx) } }, 'RACK ' + (rack.idx + 1)));
      var members = el('div', {
        class: 'rack-members',
        style: { gridTemplateRows: 'repeat(' + perColRows + ',1fr)' }
      });
      rack.members.forEach(function (m, i) {
        members.append(rackRow(groups[0].exx, m, i, sn));
      });
      card.append(members);
    } else {
      var exCrowded = rack.members.length + groups.length > (twoRows ? 4 : 6);
      card = el('div', { class: 'rack-card ' + tier + (exCrowded ? ' crowded' : '') },
        el('div', { class: 'rack-head', style: { '--plate-col': plateColor(rack.idx) } }, 'RACK ' + (rack.idx + 1)));
      var wrap = el('div', { class: 'rack-exgroups' });
      groups.forEach(function (g) {
        var sn = setNumFor(g.eb.exercises.length);
        var grp = el('div', { class: 'rack-exgroup' + (swapped ? ' exswap' : '') },
          el('div', { class: 'rack-exlabel' }, (preview ? 'NEXT: ' : '') + (g.exx.name || 'Exercise').toUpperCase()));
        g.list.forEach(function (it) { grp.append(rackRow(g.exx, it[0], it[1], sn)); });
        wrap.append(grp);
      });
      card.append(wrap);
    }
    grid.append(card);
  });
}

/* ================= run: input ================= */
$('#rr-full').addEventListener('click', toggleFullscreen);
$('#rr-plus30').addEventListener('click', function () { nudge(30); });
$('#rr-minus30').addEventListener('click', function () { nudge(-30); });
$('#rr-pausebtn').addEventListener('click', function () {
  if (!run || run.status === 'done') return;
  if (run.status === 'running') pauseRun(); else resumeRun();
});
$('#rr-exit').addEventListener('click', function () { if (run) exitRun(); });
$('#rr-overlay-exit').addEventListener('click', function () { if (run) exitRun(); });

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(function () { });
  else $('#run').requestFullscreen().catch(function () { });
}

function resetCursorTimer() {
  $('#run').classList.remove('nocursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(function () {
    if (run) $('#run').classList.add('nocursor');
  }, 3000);
}
$('#run').addEventListener('mousemove', resetCursorTimer);

document.addEventListener('keydown', function (e) {
  if (!run) {
    if (e.key === 'Escape' && !$('#picker').hidden) closePicker();
    return;
  }
  if (run.status === 'done') {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); exitRun(); }
    return;
  }
  if (e.target.closest && e.target.closest('#rr-roster')) {
    // pause-roster widgets own their keys (Space on Add must not resume; arrows drive the select)
    if (e.key === 'Escape') { e.preventDefault(); exitRun(); }
    return;
  }
  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (run.status === 'running') pauseRun(); else resumeRun();
      break;
    case 'ArrowRight':
    case 'PageDown': // presenter remotes send PageDown/PageUp
      e.preventDefault();
      advance(true);
      break;
    case 'ArrowLeft':
    case 'PageUp':
      e.preventDefault();
      goBack();
      break;
    case 'ArrowUp':
      e.preventDefault();
      nudge(30);
      break;
    case 'ArrowDown':
      e.preventDefault();
      nudge(-30);
      break;
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
    case 'Escape':
      if (run.status === 'running') pauseRun();
      else exitRun();
      break;
  }
});

window.addEventListener('beforeunload', function (e) {
  if (run && run.status !== 'done') { e.preventDefault(); e.returnValue = ''; }
});

/* ================= boot ================= */
showTab('athletes');
refreshBackupBadge();
