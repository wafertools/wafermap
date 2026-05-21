import type { Scene } from '../renderer/buildScene.js';
import { getColorScheme } from '../renderer/colorSchemes.js';

export interface PlotlyOutput {
  data: object[];
  layout: object;
}

export interface ToPlotlyOptions {
  showAxes?: boolean;
  /** Show "(mm)" unit suffix on axis titles and display raw mm tick values. Default false. */
  showPhysicalUnits?: boolean;
  /**
   * Die pitch in mm. When provided and showPhysicalUnits is false, axis ticks show die grid
   * indices (integers) instead of mm coordinates. Pass the same width/height used in
   * generateDies().
   */
  diePitchMm?: { x: number; y: number };
  /** Override axis title text. Defaults to "X" / "Y" (or "Die X" / "Die Y" with diePitchMm). */
  axisLabels?: { x?: string; y?: string };
  /**
   * Show the continuous colorbar for value / softbin / stackedValues modes.
   * Default `true`.  Set to `false` for minimal or embedded layouts.
   */
  showColorbar?: boolean;
}

/**
 * Convert a renderer Scene to Plotly-compatible { data, layout }.
 *
 * Architecture:
 *   layout.shapes  → die rectangles and overlay paths
 *   data[0]        → invisible scatter for hover (one point per die)
 *   data[1]        → text overlay scatter (if texts present)
 *   data[2]        → optional reference trace for a continuous colorbar
 */
function diePitchTicks(pitch: number): { tickvals: number[]; ticktext: string[] } {
  const n = Math.ceil(500 / pitch);
  const tickvals: number[] = [];
  const ticktext: string[] = [];
  for (let i = -n; i <= n; i++) {
    tickvals.push(i * pitch);
    ticktext.push(String(i));
  }
  return { tickvals, ticktext };
}

export function toPlotly(scene: Scene, options: ToPlotlyOptions = {}): PlotlyOutput {
  const { showAxes = false, showPhysicalUnits = false, diePitchMm, axisLabels = {}, showColorbar = true } = options;
  const useIndexTicks = showAxes && !!diePitchMm && !showPhysicalUnits;
  const unitSuffix = showPhysicalUnits ? ' (mm)' : '';
  const defaultXLabel = diePitchMm && !showPhysicalUnits ? 'Die X' : 'X';
  const defaultYLabel = diePitchMm && !showPhysicalUnits ? 'Die Y' : 'Y';
  const xLabel = (axisLabels.x ?? defaultXLabel) + unitSuffix;
  const yLabel = (axisLabels.y ?? defaultYLabel) + unitSuffix;
  const { rectangles, hoverPoints, texts, overlays, plotMode, colorScheme, valueRange } = scene;

  // For axis-aligned scenes (no rotation, no flip) generate the path from numeric coords.
  // For rotated scenes scene.rotation is non-zero — path is pre-built on the rect (empty otherwise).
  const isAxisAligned = scene.rotation === 0 && !scene.axisFlip.x && !scene.axisFlip.y;
  function rectPath(r: { x: number; y: number; width: number; height: number; path: string }): string {
    if (isAxisAligned) {
      const x1 = r.x - r.width / 2, y1 = r.y - r.height / 2;
      const x2 = r.x + r.width / 2, y2 = r.y + r.height / 2;
      return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`;
    }
    return r.path;
  }

  const shapes = [
    ...rectangles.map((rectangle) => ({
      type: 'path',
      path: rectPath(rectangle),
      fillcolor: rectangle.fill,
      line: { color: 'rgba(0,0,0,0.18)', width: 0.5 },
      layer: 'below',
    })),
    ...overlays.map((overlay) => ({
      type: 'path',
      path: overlay.path,
      fillcolor: overlay.fill ?? 'rgba(0,0,0,0)',
      line: { color: overlay.lineColor, width: overlay.lineWidth },
      layer: 'above',
    })),
  ];

  const traces: object[] = [];

  traces.push({
    type: 'scatter', mode: 'markers',
    x: hoverPoints.map((p) => p.x),
    y: hoverPoints.map((p) => p.y),
    text: hoverPoints.map((p) => p.text),
    hoverinfo: 'text',
    hovertemplate: '%{text}<extra></extra>',
    marker: { size: 10, color: 'rgba(0,0,0,0)', line: { width: 0 } },
    showlegend: false,
  });

  if (texts.length) {
    traces.push({
      type: 'scatter', mode: 'text',
      x: texts.map((t) => t.x),
      y: texts.map((t) => t.y),
      text: texts.map((t) => t.text),
      textposition: texts.map((t) => t.align),
      textfont: { size: texts.map((t) => t.fontSize), color: texts.map((t) => t.color) },
      hoverinfo: 'skip', showlegend: false,
    });
  }

  if (showColorbar && (plotMode === 'value' || plotMode === 'softBin' || plotMode === 'stackedValues')) {
    const colorscale = getColorScheme(colorScheme).plotlyColorscale;
    const [cmin, cmax] = valueRange ?? [0, 1];
    traces.push({
      type: 'scatter', mode: 'markers',
      x: [null], y: [null],
      marker: {
        color: [cmin], colorscale, cmin, cmax,
        showscale: true, colorbar: { title: { text: 'Value' }, x: 1.01, thickness: 14, len: 0.8 },
      },
      hoverinfo: 'skip', showlegend: false,
    });
  }

  const xaxis: Record<string, unknown> = {
    scaleanchor: 'y', scaleratio: 1,
    showticklabels: showAxes, zeroline: showAxes, showgrid: showAxes,
  };
  if (showAxes) {
    xaxis['title'] = { text: xLabel };
    if (useIndexTicks) {
      const { tickvals, ticktext } = diePitchTicks(diePitchMm!.x);
      xaxis['tickvals'] = tickvals;
      xaxis['ticktext'] = ticktext;
    }
  }

  const yaxis: Record<string, unknown> = {
    showticklabels: showAxes, zeroline: showAxes, showgrid: showAxes,
  };
  if (showAxes) {
    yaxis['title'] = { text: yLabel };
    if (useIndexTicks) {
      const { tickvals, ticktext } = diePitchTicks(diePitchMm!.y);
      yaxis['tickvals'] = tickvals;
      yaxis['ticktext'] = ticktext;
    }
  }

  const layout = {
    xaxis,
    yaxis,
    plot_bgcolor: '#f5f5f5',
    margin: { t: 10, l: 10, r: 60, b: 10 },
    shapes,
    showlegend: false,
    hovermode: 'closest',
  };

  return { data: traces, layout };
}
