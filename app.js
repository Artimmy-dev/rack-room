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
    grouping: { count: 2, mode: 'similar', stat: 'total', assignments: {} }
  };
}

function loadState() {
  var raw = localStorage.getItem(LS_KEY);
  if (raw == null) return emptyState();
  try {
    var s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || !Array.isArray(s.athletes)) throw new Error('bad shape');
    if (!Array.isArray(s.workouts)) s.workouts = [];
    if (!s.grouping || typeof s.grouping !== 'object') s.grouping = emptyState().grouping;
    if (!s.grouping.assignments || typeof s.grouping.assignments !== 'object') s.grouping.assignments = {};
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
    return s;
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

function maxRacks() { return Math.min(8, state.athletes.length); }

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
  if (name === 'athletes') renderAthletes();
  else if (name === 'workouts') renderWorkouts();
  else renderGroups();
}

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
  var n = parseFloat(v);
  return (isFinite(n) && n > 0) ? n : null;
}

function renderAthletes() {
  var root = $('#tab-athletes');
  root.innerHTML = '';

  var table = el('table', {}, el('thead', {}, el('tr', {},
    el('th', {}, 'Name'),
    el('th', { class: 'num' }, 'Squat'),
    el('th', { class: 'num' }, 'Bench'),
    el('th', { class: 'num' }, 'Clean'),
    el('th', { class: 'num' }, 'Deadlift'),
    el('th', { class: 'num' }, 'Total'),
    el('th', {}, '')
  )));
  var tbody = el('tbody');
  table.append(tbody);

  // quick-add row
  var qInputs = {};
  var qaRow = el('tr', { class: 'quickadd' });
  var fields = [['name', 'Name', 'text'], ['squat', 'Sq', 'number'], ['bench', 'Be', 'number'], ['clean', 'Cl', 'number'], ['deadlift', 'DL', 'number']];
  fields.forEach(function (f) {
    var input = el('input', {
      id: 'qa-' + f[0], type: f[2], placeholder: f[1],
      inputmode: f[2] === 'number' ? 'numeric' : null, min: f[2] === 'number' ? '0' : null,
      onkeydown: function (e) { if (e.key === 'Enter') commitQuickAdd(); }
    });
    qInputs[f[0]] = input;
    qaRow.append(el('td', {}, input));
  });
  qaRow.append(el('td', {}), el('td', {}));
  tbody.append(qaRow);

  function commitQuickAdd() {
    var name = qInputs.name.value.trim();
    if (!name) { qInputs.name.focus(); return; }
    state.athletes.push({
      id: uuid(), name: name,
      maxes: {
        squat: parseMax(qInputs.squat.value), bench: parseMax(qInputs.bench.value),
        clean: parseMax(qInputs.clean.value), deadlift: parseMax(qInputs.deadlift.value)
      }
    });
    save();
    renderAthletes();
    $('#qa-name').focus();
  }

  var sorted = state.athletes.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  sorted.forEach(function (a) {
    var tr = el('tr', {});
    tr.append(editableCell(a, 'name'));
    MAX_KEYS.forEach(function (k) { tr.append(editableCell(a, k)); });
    tr.append(el('td', { class: 'num total' }, String(total(a))));
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

  if (state.athletes.length === 0) {
    root.append(el('div', { class: 'empty-msg' },
      el('div', {}, 'No athletes yet. Add one above, or'),
      el('button', {
        class: 'btn', onclick: function () {
          SAMPLE_TEAM.forEach(function (s) {
            state.athletes.push({ id: uuid(), name: s[0], maxes: { squat: s[1], bench: s[2], clean: s[3], deadlift: s[4] } });
          });
          save();
          renderAthletes();
        }
      }, 'Load sample team')));
  }
}

function editableCell(athlete, key) {
  var isName = key === 'name';
  var display = isName ? athlete.name : (athlete.maxes[key] == null ? '—' : String(athlete.maxes[key]));
  var td = el('td', { class: 'editable' + (isName ? '' : ' num'), tabindex: '0' }, display);

  function beginEdit() {
    if (td.querySelector('input')) return;
    var input = el('input', {
      class: 'cell-edit', type: isName ? 'text' : 'number',
      inputmode: isName ? null : 'numeric',
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
      } else {
        athlete.maxes[key] = v === '' ? null : (parseMax(v) != null ? parseMax(v) : athlete.maxes[key]);
      }
      save();
      renderAthletes();
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
  w.blocks.forEach(function (b) {
    var rounds = b.sets * b.exercises.length;
    t += rounds * b.workSec + (rounds - 1) * b.restSec;
  });
  if (w.blocks.length > 1) t += (w.blocks.length - 1) * w.transitionSec;
  return t;
}

function renderWorkouts() {
  var root = $('#tab-workouts');
  root.innerHTML = '';

  var rail = el('div', { class: 'wo-rail' });
  rail.append(el('button', {
    class: 'btn primary', onclick: function () {
      var w = { id: uuid(), name: 'Untitled', transitionSec: 60, blocks: [] };
      state.workouts.push(w);
      selectedWorkoutId = w.id;
      save();
      renderWorkouts();
      var nm = $('#wo-name');
      if (nm) { nm.focus(); nm.select(); }
    }
  }, '+ New workout'));

  state.workouts.forEach(function (w) {
    rail.append(el('div', { class: 'wo-row' + (w.id === selectedWorkoutId ? ' is-selected' : '') },
      el('button', {
        class: 'wo-row-name', onclick: function () { selectedWorkoutId = w.id; renderWorkouts(); }
      }, w.name),
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
  editor.append(el('div', { class: 'wo-editor-head' },
    nameInput,
    el('label', { class: 'wo-trans' }, 'Transition between blocks: ', transInput, ' sec')));

  w.blocks.forEach(function (b, bi) {
    editor.append(blockCard(w, b, bi));
  });

  editor.append(el('div', { class: 'wo-foot' },
    el('button', {
      class: 'btn', onclick: function () {
        var prev = w.blocks[w.blocks.length - 1];
        var prevEx = prev ? prev.exercises[0] : null;
        w.blocks.push(prev
          ? { id: uuid(), sets: prev.sets, workSec: prev.workSec, restSec: prev.restSec, exercises: [{ id: uuid(), name: '', reps: prevEx.reps, maxKey: prevEx.maxKey, pct: prevEx.pct }] }
          : { id: uuid(), sets: 3, workSec: 45, restSec: 90, exercises: [{ id: uuid(), name: '', reps: 5, maxKey: null, pct: null }] });
        save();
        renderWorkouts();
        var cards = document.querySelectorAll('.block-card');
        var last = cards[cards.length - 1];
        if (last) last.querySelector('input[type=text]').focus();
      }
    }, '+ Add block'),
    el('div', { class: 'wo-total' }, 'Total: ', el('b', {}, fmtClockPad(workoutTotalSec(w))))));

  root.append(editor);
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
      el('span', { class: 'block-head-btns' },
        moveBtn(-1, '↑'), moveBtn(1, '↓'),
        el('button', {
          class: 'rowbtn', 'aria-label': 'Remove block',
          onclick: function () { w.blocks.splice(bi, 1); save(); renderWorkouts(); }
        }, '✕'))));

  var table = el('table', { class: 'blocks-table' }, el('thead', {}, el('tr', {},
    el('th', {}, 'Exercise'), el('th', { class: 'num' }, 'Reps'),
    el('th', { class: 'num' }, '%1RM'), el('th', {}, 'of'), el('th', {}, '')
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
      b.exercises.push({ id: uuid(), name: '', reps: prev.reps, maxKey: prev.maxKey, pct: prev.pct });
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
    type: 'number', min: '1', value: ex.reps, inputmode: 'numeric',
    onchange: function () {
      var n = parseInt(repsInput.value, 10);
      ex.reps = (isFinite(n) && n >= 1) ? n : 1;
      save();
      renderWorkouts();
    }
  });

  // pct + "of" are a pair: both null or both set. pct stays enabled so that
  // entering a pct while "of" is "—" can auto-select Squat (spec'd behavior).
  var pctInput = el('input', {
    type: 'number', min: '1', max: '150', value: ex.pct == null ? '' : ex.pct, inputmode: 'numeric',
    onchange: function () {
      var v = pctInput.value.trim();
      if (v === '') { ex.pct = null; ex.maxKey = null; }
      else {
        var n = parseInt(v, 10);
        if (!isFinite(n)) n = 75;
        ex.pct = Math.max(1, Math.min(150, n));
        if (ex.maxKey == null) ex.maxKey = 'squat';
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

  return el('tr', {},
    el('td', {}, nameInput),
    el('td', { class: 'num' }, repsInput),
    el('td', { class: 'num' }, pctInput),
    el('td', {}, ofSelect),
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
  g.count = Math.max(1, Math.min(g.count, maxRacks()));
  var sorted = state.athletes.slice().sort(function (a, b) {
    return statValue(b, g.stat) - statValue(a, g.stat) || a.name.localeCompare(b.name);
  });
  var asg = {};
  if (g.mode === 'similar') {
    var n = sorted.length, base = Math.floor(n / g.count), extra = n % g.count, idx = 0;
    for (var r = 0; r < g.count; r++) {
      var size = base + (r < extra ? 1 : 0);
      for (var k = 0; k < size; k++) asg[sorted[idx++].id] = r;
    }
  } else { // balanced: snake draft
    var pos = 0, dir = 1;
    sorted.forEach(function (a) {
      asg[a.id] = pos;
      pos += dir;
      if (pos === g.count) { pos = g.count - 1; dir = -1; }
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

  if (state.athletes.length === 0) {
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
  root.append(controls);

  // bucket athletes
  var byRack = {}, unassigned = [];
  state.athletes.forEach(function (a) {
    var r = g.assignments[a.id];
    if (r == null) unassigned.push(a);
    else (byRack[r] = byRack[r] || []).push(a);
  });
  var maxIdx = Object.keys(byRack).reduce(function (m, k) { return Math.max(m, Number(k)); }, -1);
  var cardCount = Math.max(g.count, maxIdx + 1);

  function memberRow(a, rackIdx) {
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
      el('span', { class: 'gm-name' }, a.name),
      el('span', { class: 'gm-val' }, val), sel);
  }

  var cards = el('div', { class: 'grp-cards' });
  for (var r = 0; r < cardCount; r++) {
    var members = (byRack[r] || []).slice().sort(function (a, b) { return statValue(b, g.stat) - statValue(a, g.stat); });
    var card = el('div', { class: 'grp-card', style: { '--plate': plateColor(r) } },
      el('h3', {}, 'Rack ' + (r + 1), el('small', {}, members.length + (members.length === 1 ? ' athlete' : ' athletes'))));
    members.forEach(function (a) { card.append(memberRow(a, r)); });
    cards.append(card);
  }
  if (unassigned.length) {
    var uc = el('div', { class: 'grp-card unassigned' },
      el('h3', {}, 'Unassigned'),
      el('div', { class: 'grp-hint' }, 'New athletes — assign manually or Regenerate.'));
    unassigned.forEach(function (a) { uc.append(memberRow(a, null)); });
    cards.append(uc);
  }
  root.append(cards);
}

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
      el('span', { class: 'pr-dur' }, fmtClockPad(workoutTotalSec(w)))));
  });
  if (state.athletes.length) {
    var assigned = 0;
    state.athletes.forEach(function (a) {
      var r = state.grouping.assignments[a.id];
      if (r != null && r <= 7) assigned++;
    });
    var un = state.athletes.length - assigned;
    if (assigned === 0) {
      list.append(el('div', { class: 'picker-warn' }, 'No rack assignments — the run will show no athletes. Visit Groups and Regenerate first.'));
    } else if (un > 0) {
      list.append(el('div', { class: 'picker-warn' }, un + ' unassigned athlete' + (un === 1 ? '' : 's') + ' will not appear on the run screen.'));
    }
  }
  var sel = state.workouts.find(function (x) { return x.id === pickerSelectedId; });
  $('#picker-start').disabled = !(sel && isRunnable(sel));
  $('#picker').hidden = false;
  var ft = list.querySelector('.picker-row.is-selected') || $('#picker-cancel');
  ft.focus();
}

function closePicker() {
  $('#picker').hidden = true;
  $('#run-btn').focus();
}

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
  state.athletes.forEach(function (a) {
    var r = state.grouping.assignments[a.id];
    if (r == null || r > 7) return;
    (byRack[r] = byRack[r] || []).push({ name: a.name, maxes: Object.assign({}, a.maxes) });
  });
  return Object.keys(byRack).map(Number).sort(function (a, b) { return a - b; })
    .map(function (idx) { return { idx: idx, members: byRack[idx] }; });
}

/* ================= run: state machine ================= */
var run = null;
var audioCtx = null;
var wakeLock = null;
var cursorTimer = null;

function beep(freq, ms) {
  if (!audioCtx) return;
  try {
    var o = audioCtx.createOscillator();
    var gn = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(gn);
    gn.connect(audioCtx.destination);
    var t = audioCtx.currentTime;
    gn.gain.setValueAtTime(0.2, t);
    gn.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
    o.start(t);
    o.stop(t + ms / 1000);
  } catch (e) { /* audio unavailable */ }
}

function acquireWakeLock() {
  if (!navigator.wakeLock) return;
  navigator.wakeLock.request('screen').then(function (wl) { wakeLock = wl; }).catch(function () { });
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(function () { }); wakeLock = null; }
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && run && run.status !== 'done') acquireWakeLock();
});

function startRun(w) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch (e) { audioCtx = null; }

  var workout = JSON.parse(JSON.stringify(w)); // snapshot
  run = {
    workout: workout,
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

  $('#shell').hidden = true;
  $('#run').hidden = false;
  $('#rr-overlay').hidden = true;
  $('#rr-exit').hidden = true;
  $('#rr-timer').hidden = false;
  $('#rr-grid').hidden = false;
  $('#rr-pausebtn').hidden = false;
  $('#rr-pausebtn').innerHTML = '&#10074;&#10074;';
  $('#rr-setline').classList.remove('done-time');

  beep(440, 600);
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

function tick() {
  if (!run || run.status !== 'running') return;
  var remaining = run.phaseEndsAt - Date.now();
  if (remaining <= 0) { advance(); return; }
  var sec = Math.ceil(remaining / 1000);
  $('#rr-timer').textContent = fmtClock(sec);
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
  else if (manual) { run.phaseEndsAt = Date.now() + dur; beep(440, 600); }
  else {
    // chain from the old deadline so overshoot carries; skip phases missed while hidden/suspended
    run.phaseEndsAt += dur;
    while (run.phaseEndsAt <= Date.now()) {
      run.i++;
      if (run.i >= run.phases.length) { finish(); return; }
      run.phaseEndsAt += run.phases[run.i].dur * 1000;
    }
    beep(440, 600);
  }
  renderRunPhase();
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
  else run.phaseEndsAt = Date.now() + dur;
  renderRunPhase();
  renderTimerNow();
}

function renderTimerNow() {
  if (run.status === 'done') return;
  var rem = run.status === 'paused' ? run.pausedRemaining : run.phaseEndsAt - Date.now();
  $('#rr-timer').textContent = fmtClock(Math.max(0, Math.ceil(rem / 1000)));
  $('#rr-timer').classList.remove('pulse');
}

function pauseRun() {
  if (run.status !== 'running') return;
  run.pausedRemaining = run.phaseEndsAt - Date.now();
  run.pauseStart = Date.now();
  run.status = 'paused';
  $('#rr-overlay').hidden = false;
  $('#rr-pausebtn').innerHTML = '&#9654;';
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
  beep(440, 600);
  setTimeout(function () { beep(440, 600); }, 800);
  releaseWakeLock();

  var elapsed = Math.max(0, Math.round((Date.now() - run.startedAt - run.pausedTotal) / 1000));
  var runEl = $('#run');
  runEl.className = 'phase-done' + (runEl.classList.contains('nocursor') ? ' nocursor' : '');
  $('#rr-progress-fill').style.width = '100%';
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
  $('#rr-overlay').hidden = true;
  $('#rr-pausebtn').hidden = true;
  $('#rr-exit').hidden = false;
  $('#rr-exit').focus();
}

function exitRun() {
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

  $('#rr-progress-fill').style.width = (run.i / run.phases.length * 100) + '%';

  var lift = currentOrNextLift();
  var dispBlockIndex = lift ? lift.blockIndex : p.blockIndex;
  var dispBlock = w.blocks[dispBlockIndex];

  $('#rr-title').textContent = w.name + '  ·  BLOCK ' + (dispBlockIndex + 1) + ' OF ' + w.blocks.length;

  var word, exText, set, roundIdx;
  if (p.type === 'LIFT') {
    word = 'LIFT';
    exText = exNames(dispBlock);
    set = p.set;
    roundIdx = p.set - 1;
  } else {
    word = p.type === 'REST' ? 'REST' : 'TRANSITION — GO TO YOUR RACK';
    var nl = nextLiftAfter();
    var nb = nl ? w.blocks[nl.blockIndex] : dispBlock;
    exText = 'NEXT: ' + exNames(nb);
    // REST within the same block keeps the current round's assignments (and its round number,
    // so label and grid agree for multi-exercise blocks); otherwise preview the next lift's round
    var sameBlockRest = p.type === 'REST' && (!nl || nl.blockIndex === p.blockIndex);
    roundIdx = sameBlockRest ? p.set - 1 : (nl ? nl.set - 1 : 0);
    set = (sameBlockRest && nb.exercises.length > 1) ? p.set : (nl ? nl.set : 1);
    if (nl) { dispBlockIndex = nl.blockIndex; dispBlock = nb; }
  }
  $('#rr-phaseword').textContent = word;

  var ex = $('#rr-exercise');
  ex.style.fontSize = '';
  ex.textContent = exText;
  fitText(ex);

  var E = dispBlock.exercises.length;
  $('#rr-setline').textContent = E === 1
    ? 'SET ' + set + ' OF ' + dispBlock.sets + ' · ' + dispBlock.exercises[0].reps + ' REPS'
    : 'ROUND ' + set + ' OF ' + (dispBlock.sets * E);

  var strip = $('#rr-loadstrip');
  if (p.type === 'TRANSITION') {
    strip.hidden = false;
    strip.textContent = 'LOAD FOR ' + (E === 1 ? (dispBlock.exercises[0].name || 'NEXT BLOCK') : exNames(dispBlock)).toUpperCase() + ': weights below';
  } else {
    strip.hidden = true;
  }

  renderRunGrid(dispBlock, roundIdx);
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

function renderRunGrid(block, roundIdx) {
  var grid = $('#rr-grid');
  grid.innerHTML = '';
  var racks = run.racks;
  var n = racks.length;
  if (n === 0) return;

  var twoRows = n > 4;
  var cols = twoRows ? Math.ceil(n / 2) : n;
  grid.className = twoRows ? 'rows-2' : 'rows-1';
  grid.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
  var tier = twoRows ? 'tier-b' : 'tier-a';
  var tierRows = twoRows ? 3 : 6;
  var E = block.exercises.length;

  // flash the exercise groups only when the rotation actually changed (new round, same block)
  var swapped = run.lastGrid && run.lastGrid.block === block && run.lastGrid.round !== roundIdx;
  run.lastGrid = { block: block, round: roundIdx };

  function rackRow(exx, m) {
    var content;
    var max = exx.maxKey ? m.maxes[exx.maxKey] : null;
    if (exx.pct != null && exx.maxKey && max != null) {
      content = String(workingWeight(exx.pct, max));
    } else {
      content = '×' + exx.reps;
    }
    return el('div', { class: 'rack-row' },
      el('span', { class: 'rack-name' }, shortName(m.name)),
      el('span', { class: 'rack-wt' }, content));
  }

  racks.forEach(function (rack) {
    var card;
    if (E === 1) {
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
      rack.members.forEach(function (m) {
        members.append(rackRow(block.exercises[0], m));
      });
      card.append(members);
    } else {
      // member i does exercise (i + roundIdx) mod E this round
      var exCrowded = rack.members.length + E > (twoRows ? 4 : 6);
      card = el('div', { class: 'rack-card ' + tier + (exCrowded ? ' crowded' : '') },
        el('div', { class: 'rack-head', style: { '--plate-col': plateColor(rack.idx) } }, 'RACK ' + (rack.idx + 1)));
      var wrap = el('div', { class: 'rack-exgroups' });
      block.exercises.forEach(function (exx, gi) {
        var list = rack.members.filter(function (m, i) { return (i + roundIdx) % E === gi; });
        if (!list.length) return;
        var grp = el('div', { class: 'rack-exgroup' + (swapped ? ' exswap' : '') },
          el('div', { class: 'rack-exlabel' }, (exx.name || 'Exercise').toUpperCase()));
        list.forEach(function (m) { grp.append(rackRow(exx, m)); });
        wrap.append(grp);
      });
      card.append(wrap);
    }
    grid.append(card);
  });
}

/* ================= run: input ================= */
$('#rr-full').addEventListener('click', toggleFullscreen);
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
  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (run.status === 'running') pauseRun(); else resumeRun();
      break;
    case 'ArrowRight':
      e.preventDefault();
      advance(true);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      goBack();
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
