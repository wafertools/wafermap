// The JSON text's own undo and redo (canvas-adapter/plotJsonHistory.ts): steps for typing, paste and script edits alike,
// kept by the editor so they do not depend on what a browser's own undo stack holds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><textarea id="t"></textarea>', { url: 'http://localhost/' });
globalThis.Event = dom.window.Event;
const { createTextHistory } = await import('../dist/packages/canvas-adapter/plotJsonHistory.js');

const area = dom.window.document.getElementById('t');
const input = (inputType, data = null) => area.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType, data }));
/** Type `text` one character at a time, as a keyboard does. */
const type = (text) => { for (const ch of text) { area.value += ch; area.setSelectionRange(area.value.length, area.value.length); input('insertText', ch); } };
/** Replace the whole text in one go, as a paste, an accepted suggestion or a chosen plot does. */
const replace = (text, kind = 'insertText') => { area.value = text; area.setSelectionRange(text.length, text.length); input(kind, text); };
const fresh = (text = '') => { area.value = text; area.setSelectionRange(text.length, text.length); let t = 0; const h = createTextHistory(area, () => t); return { h, tick: (ms) => { t += ms; } }; };

test('typing is one step until a pause, so one undo takes back the word', () => {
  const { h, tick } = fresh('{ "a": ');
  type('tru'); tick(50); type('e');
  tick(2000);
  type('x');
  assert.equal(area.value, '{ "a": truex');
  assert.ok(h.undo());
  assert.equal(area.value, '{ "a": true', 'the x, typed after a pause, is its own step');
  assert.ok(h.undo());
  assert.equal(area.value, '{ "a": ', 'the word typed in one go is one step');
  assert.equal(h.undo(), false, 'nothing earlier');
  assert.equal(h.canUndo, false);
});

test('a space, a comma or a new line ends a step, and a change of direction starts one', () => {
  const { h } = fresh('');
  type('ab'); type(' '); type('cd');
  h.undo();
  assert.equal(area.value, 'ab ', 'the word after the space');
  h.undo();
  assert.equal(area.value, 'ab', 'the space');
  const g = fresh('hello');
  area.value = 'hell'; input('deleteContentBackward');
  area.value = 'hel'; input('deleteContentBackward');
  type('p');
  g.h.undo();
  assert.equal(area.value, 'hel', 'the insertion is not joined to the deleting');
  g.h.undo();
  assert.equal(area.value, 'hello', 'the two deletions are one step');
});

test('a paste, an accepted suggestion or a chosen plot is a step of its own, however the text was set', () => {
  const { h } = fresh('before');
  replace('pasted text', 'insertFromPaste');
  replace('pasted text, accepted', 'insertText');
  assert.ok(h.undo());
  assert.equal(area.value, 'pasted text');
  assert.ok(h.undo());
  assert.equal(area.value, 'before');
  // An edit made by script that fires no input type at all is a step too.
  area.value = 'by script'; area.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.ok(h.undo());
  assert.equal(area.value, 'before');
});

test('redo goes forward again, and a new change drops what had been undone', () => {
  const { h } = fresh('a');
  replace('ab'); replace('abc');
  h.undo(); h.undo();
  assert.equal(area.value, 'a');
  assert.ok(h.canRedo);
  assert.ok(h.redo());
  assert.equal(area.value, 'ab');
  replace('abX');
  assert.equal(h.canRedo, false, 'the redo history is gone');
  assert.equal(h.redo(), false);
  h.undo();
  assert.equal(area.value, 'ab');
});

test('stepping tells the rest of the editor as a history input, once, and does not record itself', () => {
  const { h } = fresh('x');
  replace('xy');
  const heard = [];
  area.addEventListener('input', e => heard.push(e.inputType));
  h.undo();
  assert.deepEqual(heard, ['historyUndo']);
  h.redo();
  assert.deepEqual(heard, ['historyUndo', 'historyRedo']);
  h.undo();
  assert.equal(area.value, 'x');
  assert.equal(h.canRedo, true, 'undoing did not add a step');
});

test('the caret goes back with the text', () => {
  const { h } = fresh('abc');
  area.value = 'abXc'; area.setSelectionRange(3, 3); input('insertText', 'X');
  area.setSelectionRange(1, 1);
  h.undo();
  assert.equal(area.value, 'abc');
  assert.equal(area.selectionStart, 3, 'at the end it was created at');
});
