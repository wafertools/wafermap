import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap } from '../dist/index.js';
import { createWafermapWorker } from '../dist/packages/worker/index.js';
import { detachTables, dieLink, testValue, recordedVerdict } from '../dist/packages/core/dieTable.js';

/** What the worker posts for a built result, through a real structured clone with its transfer list. */
function posted(result) {
  const { transfer, ...tables } = detachTables([result.dies]);
  return structuredClone({ type: 'result', result, tables }, { transfer });
}

class FakeWorker {
  constructor() {
    this.messages = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

test('createWafermapWorker forwards requests, resolves results, and rejects failures', async () => {
  const worker = new FakeWorker();
  const wrapper = createWafermapWorker(worker);

  const input = {
    results: [{ x: 0, y: 0, testValues: { 0: 1 }, hbin: 1 }],
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  };

  const expected = buildWaferMap(input);
  const promise = wrapper.run(input);

  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].type, 'run');
  assert.equal(worker.messages[0].id, 0);

  worker.onmessage?.({ data: { ...posted(buildWaferMap(input)), id: 0 } });
  await assert.doesNotReject(promise);
  const resolved = await promise;
  assert.equal(resolved.wafer.diameter, expected.wafer.diameter);
  assert.equal(resolved.dies.length, expected.dies.length);

  const failing = wrapper.run(input);
  worker.onmessage?.({ data: { type: 'error', id: 1, message: 'boom' } });
  await assert.rejects(failing, /boom/);

  const pending = wrapper.run(input);
  wrapper.terminate();
  assert.equal(worker.terminated, true);
  await assert.rejects(pending, /Worker terminated/);
});

test('createWafermapWorker handles malformed messages', async () => {
  const worker = new FakeWorker();
  const wrapper = createWafermapWorker(worker);

  const input = {
    results: [{ x: 0, y: 0, testValues: { 0: 1 }, hbin: 1 }],
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  };

  const promise = wrapper.run(input);

  // Send malformed message
  worker.onmessage?.({ data: { type: 'invalid' } });

  // Should not resolve or reject immediately
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(worker.messages.length, 1);

  // Send proper message
  worker.onmessage?.({ data: { ...posted(buildWaferMap(input)), id: 0 } });
  await assert.doesNotReject(promise);
});

test('createWafermapWorker handles out-of-order responses', async () => {
  const worker = new FakeWorker();
  const wrapper = createWafermapWorker(worker);

  const input1 = { results: [{ x: 0, y: 0, testValues: { 0: 1 }, hbin: 1 }], waferConfig: { diameter: 40 }, dieConfig: { width: 10, height: 10 } };
  const input2 = { results: [{ x: 1, y: 1, testValues: { 0: 2 }, hbin: 2 }], waferConfig: { diameter: 40 }, dieConfig: { width: 10, height: 10 } };

  const promise1 = wrapper.run(input1);
  const promise2 = wrapper.run(input2);

  // Send responses out of order
  worker.onmessage?.({ data: { ...posted(buildWaferMap(input2)), id: 1 } });
  worker.onmessage?.({ data: { ...posted(buildWaferMap(input1)), id: 0 } });

  await assert.doesNotReject(promise1);
  await assert.doesNotReject(promise2);
});

test('a result crosses the worker boundary with its columns moved, not its values copied', async () => {
  const input = {
    results: [
      { x: 0, y: 0, hbin: 1, testValues: { 7: 1.5, 8: 2 }, testPass: { 9: true } },
      { x: 1, y: 0, hbin: 2, testValues: { 7: 2.5 } },
      { hbin: 1, testValues: { 8: 4 } },
    ],
  };
  const reference = buildWaferMap(input);
  const sent = buildWaferMap(input);
  const table = dieLink(sent.dies[0]).table;
  const message = posted(sent);
  assert.equal(table.values.get(7).length, 0, 'the sender\'s columns were transferred, not copied');
  assert.equal(message.result.dies.every(d => !('testValues' in d) && !('testPass' in d)), true,
    'no value objects were built for the clone');

  const worker = new FakeWorker();
  const wrapper = createWafermapWorker(worker);
  const promise = wrapper.run(input);
  worker.onmessage?.({ data: { ...message, id: 0 } });
  const got = await promise;
  got.dies.forEach((d, i) => {
    const want = reference.dies[i];
    assert.ok(dieLink(d), `die ${d.id} is linked again`);
    for (const tn of [7, 8, 9]) {
      assert.equal(testValue(d, tn), testValue(want, tn));
      assert.equal(recordedVerdict(d, tn), recordedVerdict(want, tn));
    }
    assert.deepEqual(d.testValues, want.testValues);
    assert.deepEqual(d.testPass, want.testPass);
  });
  assert.equal(got.view.dies[0], got.dies[0], 'the view holds the same die objects as the result');
});
