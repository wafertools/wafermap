import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap } from '../dist/index.js';
import { createWafermapWorker } from '../dist/packages/worker/index.js';

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
    results: [{ x: 0, y: 0, values: [1], bins: [1] }],
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  };

  const expected = buildWaferMap(input);
  const promise = wrapper.run(input);

  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].type, 'run');
  assert.equal(worker.messages[0].id, 0);

  worker.onmessage?.({ data: { type: 'result', id: 0, result: expected } });
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
