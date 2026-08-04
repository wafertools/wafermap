// Injects prev / next / home navigation into .demo-header for every guide demo.
//
// The order comes from manifest.json — the single source shared with
// scripts/build-examples-index.mjs, the zensical nav check, and the downloadable
// examples archive. Nothing here is hand-maintained; adding a demo to the
// manifest is enough. Entries are per concept, so several may share one file
// (merged pages); prev/next walks the distinct files in manifest order.
//
// Kept a classic script (not a module) so the <script> tag in every demo page
// stays as it is. The fetch is same-directory and works identically on the docs
// site and in the offline archive.
(function () {
  const header = document.querySelector('.demo-header');
  if (!header) return;

  fetch(new URL('manifest.json', document.baseURI))
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`manifest.json: ${r.status}`)))
    .then(build)
    .catch(err => {
      // Nav is an enhancement — a failure here must not take the demo with it.
      console.warn('demo-nav: could not load manifest.json —', err.message);
    });

  function build(manifest) {
    // Distinct files, in manifest order, excluding pages kept out of the nav.
    const demos = [];
    for (const d of manifest.demos) {
      if (d.nav === false) continue;
      if (!demos.includes(d.file)) demos.push(d.file);
    }

    const file = location.pathname.split('/').pop() || 'index.html';
    const idx  = demos.indexOf(file);

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
      nav.appendChild(link(demos[idx - 1], '← Prev', 'Previous demo'));

    if (idx >= 0 && idx < demos.length - 1)
      nav.appendChild(link(demos[idx + 1], 'Next →', 'Next demo'));

    header.appendChild(nav);
  }
})();
