# wafermap

<img src="docs/image-5.png" alt="wafermap demo" style="max-width:640px; display:block; margin:8px 0;" />

Browser-first wafer map visualization for semiconductor test data.

**[Project Portal: Docs & Interactive Demos →](https://telecasterer.github.io/wafermap/)**

## Quick start

```bash
npm install @paulrobins/wafermap
```

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap } from '@paulrobins/wafermap/canvas-adapter';

const { wafer, dies } = buildWaferMap({
  results: rows.map(r => ({ x: +r.x, y: +r.y, hbin: +r.hbin })),
});

renderWaferMap(document.getElementById('map'), wafer, dies);
```

## Docs

- [Guide](https://telecasterer.github.io/wafermap/guide/)
- [API Reference](docs/API.md)
- [Demo catalog](https://telecasterer.github.io/wafermap/)

The docs site is the canonical home for examples, usage notes, and API details.

## Local preview

```bash
npm install
npm run dev
```

This starts MkDocs and serves the documentation site from `docs/`, including the
example pages under `docs/examples/`.
