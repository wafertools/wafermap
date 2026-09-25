export function openHtmlReport(html: string): void {
  if (typeof (window as any).__openHtmlReport === 'function') {
    (window as any).__openHtmlReport(html);
    return;
  }
  // A blob: URL passed directly to window.open, not window.open('', ...)
  // followed by document.write — that blank-window-then-write sequence is
  // the exact pattern many browsers/extensions specifically fingerprint as
  // a popup ad (it's how they worked for a decade) and block even from a
  // direct, synchronous click. Opening a real URL is treated far more
  // leniently. document.write is also blocked outright in some sandboxed/
  // CSP contexts regardless of popup settings, which this also sidesteps.
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(url, '_blank');
  // Revoke once the new tab/window has had time to actually load the blob —
  // revoking immediately can race the navigation in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (!win) {
    // Still possible (aggressive blocker, or an environment with no real
    // window.open at all — e.g. Tauri's WebView) — was previously a fully
    // silent no-op. A host here must call setReportOpener() to supply its
    // own opener (native window, in-app modal, etc.); this at least says so.
    console.warn(
      'wmap: window.open() returned null, so the report could not be shown. ' +
      'If this host cannot use window.open (e.g. Tauri, or popups are blocked), ' +
      'call setReportOpener() to supply your own opener.'
    );
  }
}

export function setReportOpener(opener: (html: string) => void): void {
  (window as any).__openHtmlReport = opener;
}
