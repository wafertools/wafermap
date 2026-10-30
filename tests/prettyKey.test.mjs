import test from 'node:test';
import assert from 'node:assert/strict';
import { prettyKey } from '../dist/packages/core/utils.js';

test('prettyKey splits where a word starts, so an all-caps key stays whole', () => {
  assert.equal(prettyKey('TEMP'), 'TEMP');
  assert.equal(prettyKey('LOT_ID'), 'LOT ID');
  assert.equal(prettyKey('processSplit'), 'Process Split');
  assert.equal(prettyKey('waferID'), 'Wafer ID');
  assert.equal(prettyKey('testerNode2'), 'Tester Node2');
  assert.equal(prettyKey('temp'), 'Temp');
  assert.equal(prettyKey('XMLHttpRequest'), 'XML Http Request');
});
