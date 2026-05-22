# Quick Start — @paulrobins/wafermap

`@paulrobins/wafermap` renders interactive wafer maps from semiconductor die test data — colour-coded by bin or parametric value, with a built-in toolbar, tooltips, and zoom.

## Install

```bash
npm install @paulrobins/wafermap
```

## Minimal example

Copy this into an HTML file and open it in a browser. No bundler required.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My first wafer map</title>
</head>
<body>
  <!-- A wafer is a circular silicon substrate; dies (individual chips) are arranged in a grid across it. -->
  <!-- Give the container a fixed size — the canvas fills it automatically. -->
  <div id="map" style="width:600px; height:600px;"></div>

  <script type="module">
    import { buildWaferMap }  from 'https://esm.sh/@paulrobins/wafermap';
    import { renderWaferMap } from 'https://esm.sh/@paulrobins/wafermap/canvas-adapter';

    // x, y are integer die grid positions output by the prober — NOT millimetres.
    // hbin is the hard bin: the pass/fail category assigned by the test equipment.
    const results = [
      { x:  0, y:  0, hbin: 1 },  // pass
      { x:  1, y:  0, hbin: 1 },  // pass
      { x: -1, y:  0, hbin: 2 },  // fail
      { x:  0, y:  1, hbin: 1 },  // pass
      { x:  0, y: -1, hbin: 2 },  // fail
    ];

    // buildWaferMap processes die data into a wafer model. Pure function — no DOM access.
    // passBins tells the library which bin numbers count as passing yield.
    const result = buildWaferMap({ results, passBins: [1] });

    // renderWaferMap mounts an interactive canvas into the container div.
    renderWaferMap(document.getElementById('map'), result);
  </script>
</body>
</html>
```

## What you just built

The canvas shows your dies colour-coded by bin (green = pass, red = fail by default). Hover over the canvas to reveal the toolbar — use it to switch plot mode, change colour scheme, rotate or flip the wafer, toggle die labels, zoom in, or download a PNG. Hover over any individual die to see a tooltip with its coordinates and bin.

## Next steps

- **Load real CSV data** → [GUIDE.md §3](GUIDE.md#3-loading-real-data-from-a-csv)
- **Add a statistical findings panel** → [GUIDE.md §10](GUIDE.md#10-adding-statistical-findings)
- **Show multiple wafers as a gallery** → [GUIDE.md §12](GUIDE.md#12-building-a-lot-gallery)

For the full type and option reference see [API.md](API.md).
