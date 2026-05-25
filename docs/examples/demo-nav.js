// Injects prev / next / home navigation into .demo-header for every guide demo.
// Order matches the sequence in index.md (not numeric file order).
const DEMOS = [
  '01-first-map.html',
  '03-csv-data.html',
  '04-geometry.html',
  '05-named-bins.html',
  '06-test-values.html',
  '07-retests.html',
  '08-display-control.html',
  '09-interaction.html',
  '12-gallery.html',
  '15-worker.html',
  '16-color-schemes.html',
  '10-findings.html',
  '11-summary-panel.html',
  '13-lot-findings.html',
  '20-lot-stack-analysis.html',
  '14-reticle.html',
  '19-real-data.html',
  '21-mixedwm38.html',
  '18-pipeline.html',
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
