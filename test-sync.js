'use strict';
// Run: node test-sync.js
// Covers the one sync branch that can cost a coach their work. sync.js is a plain
// browser script; with no Supabase configured it wires up no DOM at load, so the
// only stub it needs to be eval'd here is localStorage.
var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

// Enough of a DOM for sync.js to wire itself up at load. Stubbed unconditionally
// so this test behaves the same whether or not Supabase creds are filled in.
function stubEl() {
  return { addEventListener: function () {}, focus: function () {}, hidden: true,
           textContent: '', className: '', title: '', disabled: false, value: '' };
}

var sandbox = {
  localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
  document: { addEventListener: function () {}, hidden: false },
  fetch: function () { return Promise.reject(new Error('no network in tests')); },
  $: stubEl,
  state: { athletes: [], workouts: [] },
  confirm: function () { return true; },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  console: console
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/sync.js', 'utf8'), sandbox);

var d = sandbox.syncDecision;

assert.strictEqual(d(false, false), 'idle', 'nothing moved: no traffic');
assert.strictEqual(d(false, true), 'push', 'only this device edited: send it up');
assert.strictEqual(d(true, false), 'adopt', 'only the cloud moved: take it');
assert.strictEqual(d(true, true), 'ask', 'both moved: never silently pick a loser');

// The whole point: a two-sided change must never resolve without the coach.
assert.notStrictEqual(d(true, true), 'adopt', 'would silently discard local edits');
assert.notStrictEqual(d(true, true), 'push', 'would silently discard cloud edits');

console.log('sync decisions OK (4 cases)');
