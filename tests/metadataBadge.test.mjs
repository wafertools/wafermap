import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;
globalThis.CSSStyleDeclaration = dom.window.CSSStyleDeclaration;

const { createMetadataBadge } = await import('../dist/packages/canvas-adapter/metadataBadge.js');

test('createMetadataBadge — isEmpty() true when there is no metadata and no lot-stack context', () => {
  const badge = createMetadataBadge(undefined);
  assert.equal(badge.isEmpty(), true);
});

test('createMetadataBadge — isEmpty() false once any metadata field is present', () => {
  const badge = createMetadataBadge({ lot: 'LOT123' });
  assert.equal(badge.isEmpty(), false);
});

test('createMetadataBadge — isEmpty() false in lot-stack mode even with no metadata fields', () => {
  const badge = createMetadataBadge(undefined, { lotStack: { lotSize: 24, aggrMethod: 'median' } });
  assert.equal(badge.isEmpty(), false);
});

test('createMetadataBadge — collapsed label joins lot + waferId when both present', () => {
  const badge = createMetadataBadge({ lot: 'LOT123', waferId: 'W01' });
  assert.match(badge.el.textContent, /LOT123 · W01/);
});

test('createMetadataBadge — collapsed label dedupes when waferId already embeds the lot string (e.g. tsmap multi-lot views)', () => {
  const badge = createMetadataBadge({ lot: 'CLUST-LOT-03', waferId: 'CLUST-LOT-03 · W02' });
  assert.equal(badge.el.querySelector('span').textContent, 'CLUST-LOT-03 · W02');
});

test('createMetadataBadge — collapsed label falls back to the first present identifying field', () => {
  const badge = createMetadataBadge({ product: 'ACME-9', temperature: 25 });
  assert.match(badge.el.textContent, /ACME-9/);
});

test('createMetadataBadge — lot-stack collapsed label leads with wafer count + method, never a waferId', () => {
  const badge = createMetadataBadge({ lot: 'LOT123', waferId: 'W01' }, { lotStack: { lotSize: 24, aggrMethod: 'median' } });
  assert.match(badge.el.textContent, /24 wafers · median/);
  assert.doesNotMatch(badge.el.textContent, /W01/);
});

test('createMetadataBadge — lot-stack with no aggrMethod omits it rather than rendering "undefined"', () => {
  const badge = createMetadataBadge(undefined, { lotStack: { lotSize: 24 } });
  assert.match(badge.el.textContent, /24 wafers/);
  assert.doesNotMatch(badge.el.textContent, /undefined/);
});

test('createMetadataBadge — click expands to show all metadata fields, second click collapses', () => {
  const badge = createMetadataBadge({ lot: 'LOT123', waferId: 'W01', product: 'ACME-9' });
  document.body.appendChild(badge.el);
  assert.equal(badge.el.getAttribute('aria-expanded'), 'false');
  assert.doesNotMatch(badge.el.textContent, /Product/);

  badge.el.click();
  assert.equal(badge.el.getAttribute('aria-expanded'), 'true');
  assert.match(badge.el.textContent, /ACME-9/);

  badge.el.click();
  assert.equal(badge.el.getAttribute('aria-expanded'), 'false');
  badge.destroy();
});

test('createMetadataBadge — Enter key toggles expand same as click', () => {
  const badge = createMetadataBadge({ lot: 'LOT123' });
  document.body.appendChild(badge.el);
  badge.el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(badge.el.getAttribute('aria-expanded'), 'true');
  badge.destroy();
});

test('createMetadataBadge — update() replaces content and re-evaluates isEmpty()', () => {
  const badge = createMetadataBadge({ lot: 'LOT123' });
  assert.equal(badge.isEmpty(), false);
  badge.update(undefined, undefined);
  assert.equal(badge.isEmpty(), true);
  badge.update({ lot: 'LOT456', waferId: 'W02' });
  assert.equal(badge.isEmpty(), false);
  assert.match(badge.el.textContent, /LOT456 · W02/);
});
