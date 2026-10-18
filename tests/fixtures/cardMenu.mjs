// A chart card's ⋯ menu (chartShell.ts cardShell), driven as a reader would: open it, read or click a row.

/** The labels of a card's ⋯ menu as it opens now (the menu is closed again). */
export function cardMenuLabels(card) {
  const btn = card.querySelector('[data-wmap-card-menu]');
  btn.click();
  const labels = [...card.ownerDocument.querySelectorAll('[data-wmap-card-menu-list] [role^="menuitem"]')].map(r => r.lastElementChild.textContent);
  if (btn.getAttribute('aria-expanded') === 'true') btn.click();
  return labels;
}

/** Open a card's ⋯ menu and click its row labelled `label`. Throws when the menu has no such row, or it is greyed. */
export function cardMenuAction(card, label) {
  card.querySelector('[data-wmap-card-menu]').click();
  const row = [...card.ownerDocument.querySelectorAll('[data-wmap-card-menu-list] [role^="menuitem"]')].find(r => r.lastElementChild.textContent === label);
  if (!row) throw new Error(`no "${label}" in the card menu`);
  if (row.getAttribute('aria-disabled') === 'true') throw new Error(`"${label}" is greyed in the card menu`);
  row.click();
}
