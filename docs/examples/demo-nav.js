// Injects prev / next / home navigation into .demo-header for every guide demo.
// Order matches the sequence in index.md (not numeric file order).
const DEMOS = [
  'first-map.html',
  'csv-data.html',
  'geometry.html',
  'partial-data.html',
  'named-bins.html',
  'metadata-mode.html',
  'test-values.html',
  'retests.html',
  'display-control.html',
  'theming.html',
  'interaction.html',
  'gallery.html',
  'worker.html',
  'color-schemes.html',
  'findings.html',
  'summary-panel.html',
  'lot-findings.html',
  'lot-stack-analysis.html',
  'reticle.html',
  'test-sites.html',
  'real-data.html',
  'mixedwm38.html',
  'pipeline.html',
];

(function () {
  const file = location.pathname.split('/').pop();
  const idx  = DEMOS.indexOf(file);

  const header = document.querySelector('.demo-header');
  if (!header) return;

  const nav = document.createElement('nav');
  nav.className = 'demo-nav';

  function link(href, label, title) {
    const a = document.createElement('a');
    a.href = href;
    a.className = 'demo-nav-btn';
    a.textContent = label;
    a.title = title;
    return a;
  }

  nav.appendChild(link('index.html', 'All demos', 'Back to demo index'));

  if (idx > 0)
    nav.appendChild(link(DEMOS[idx - 1], '← Prev', 'Previous demo'));

  if (idx >= 0 && idx < DEMOS.length - 1)
    nav.appendChild(link(DEMOS[idx + 1], 'Next →', 'Next demo'));

  header.appendChild(nav);
})();
