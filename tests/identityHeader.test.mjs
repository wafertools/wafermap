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

const { createIdentityHeader, collapsedLabel } = await import('../dist/packages/canvas-adapter/identityHeader.js');

test('collapsedLabel — joins lot + waferId when both present', () => {
  assert.equal(collapsedLabel({ lot: 'LOT123', waferId: 'W01' }, undefined), 'LOT123 · W01');
});

test('collapsedLabel — dedupes when waferId already embeds the lot string (e.g. tsmap multi-lot views)', () => {
  assert.equal(collapsedLabel({ lot: 'CLUST-LOT-03', waferId: 'CLUST-LOT-03 · W02' }, undefined), 'CLUST-LOT-03 · W02');
});

test('collapsedLabel — falls back to the first present identifying field', () => {
  assert.equal(collapsedLabel({ product: 'ACME-9', temperature: 25 }, undefined), 'ACME-9');
});

test('collapsedLabel — lot-stack leads with wafer count + method, never a waferId', () => {
  const label = collapsedLabel({ lot: 'LOT123', waferId: 'W01' }, { lotSize: 24, aggrMethod: 'median' });
  assert.equal(label, '24 wafers · median');
});

test('collapsedLabel — lot-stack with no aggrMethod omits it rather than rendering "undefined"', () => {
  assert.equal(collapsedLabel({}, { lotSize: 24 }), '24 wafers');
});

test('createIdentityHeader — isEmpty() true when there is no label, no metadata, and no lot-stack context', () => {
  const header = createIdentityHeader('', undefined);
  assert.equal(header.isEmpty(), true);
});

test('createIdentityHeader — isEmpty() false once a label is given, even with no metadata', () => {
  const header = createIdentityHeader('W1', undefined);
  assert.equal(header.isEmpty(), false);
});

test('createIdentityHeader — isEmpty() false once any metadata field is present', () => {
  const header = createIdentityHeader('', { lot: 'LOT123' });
  assert.equal(header.isEmpty(), false);
});

test('createIdentityHeader — chevron hidden and metaPanel never opens when there is nothing to expand', () => {
  const header = createIdentityHeader('W1', undefined);
  document.body.appendChild(header.wrap);
  assert.equal(header.wrap.hasAttribute('aria-expanded'), false);
  header.wrap.click();
  assert.equal(header.metaPanel.style.display, 'none');
  header.destroy();
});

test('createIdentityHeader — label renders blank, not a placeholder, when there is nothing to show', () => {
  const header = createIdentityHeader('', undefined);
  assert.equal(header.wrap.firstElementChild.textContent, '');
});

test('createIdentityHeader — collapse() force-closes an expanded panel without a matching click', () => {
  const header = createIdentityHeader('LOT123', { lot: 'LOT123' });
  document.body.appendChild(header.wrap);
  document.body.appendChild(header.metaPanel);
  header.wrap.click();
  assert.equal(header.wrap.getAttribute('aria-expanded'), 'true');
  assert.equal(header.metaPanel.style.display, 'block');

  header.collapse();
  assert.equal(header.wrap.getAttribute('aria-expanded'), 'false');
  assert.equal(header.metaPanel.style.display, 'none');
  header.destroy();
});

test('createIdentityHeader — collapse() is a no-op when already collapsed', () => {
  const header = createIdentityHeader('LOT123', { lot: 'LOT123' });
  document.body.appendChild(header.wrap);
  assert.equal(header.wrap.getAttribute('aria-expanded'), 'false');
  header.collapse();
  assert.equal(header.wrap.getAttribute('aria-expanded'), 'false');
  header.destroy();
});

test('createIdentityHeader — click expands metaPanel to show all metadata fields, second click collapses', () => {
  const header = createIdentityHeader('LOT123 · W01', { lot: 'LOT123', waferId: 'W01', product: 'ACME-9' });
  document.body.appendChild(header.wrap);
  document.body.appendChild(header.metaPanel);
  assert.equal(header.wrap.getAttribute('aria-expanded'), 'false');
  assert.doesNotMatch(header.metaPanel.textContent, /ACME-9/);

  header.wrap.click();
  assert.equal(header.wrap.getAttribute('aria-expanded'), 'true');
  assert.match(header.metaPanel.textContent, /ACME-9/);

  header.wrap.click();
  assert.equal(header.wrap.getAttribute('aria-expanded'), 'false');
  header.destroy();
});

test('createIdentityHeader — Enter key toggles expand same as click', () => {
  const header = createIdentityHeader('LOT123', { lot: 'LOT123' });
  document.body.appendChild(header.wrap);
  header.wrap.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(header.wrap.getAttribute('aria-expanded'), 'true');
  header.destroy();
});

test('createIdentityHeader — update() replaces label/metadata and re-evaluates isEmpty()', () => {
  const header = createIdentityHeader('LOT123', { lot: 'LOT123' });
  assert.equal(header.isEmpty(), false);
  header.update('', undefined, undefined);
  assert.equal(header.isEmpty(), true);
  header.update('LOT456 · W02', { lot: 'LOT456', waferId: 'W02' });
  assert.equal(header.isEmpty(), false);
  assert.equal(header.wrap.textContent.includes('LOT456 · W02'), true);
});

test('createIdentityHeader — metaPanel is absolutely positioned for overlay placement', () => {
  const header = createIdentityHeader('LOT123', { lot: 'LOT123' });
  assert.equal(header.metaPanel.style.position, 'absolute');
});
