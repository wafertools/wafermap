<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import {
    buildWaferMap,
    buildScene,
    toPlotly,
    type DieResult,
  } from 'wafermap';

  /**
   * Array of data points.  x and y are **die grid positions** (prober step
   * coordinates — integers like −7, 0, 5), not millimetre values.
   */
  export let rows: DieResult[] = [];
  /** Die width and height in mm.  Passed to buildWaferMap for physical scaling. */
  export let die: { width: number; height: number } = { width: 10, height: 10 };
  /** Wafer diameter in mm.  Inferred from grid extent when omitted. */
  export let diameter: number | undefined = undefined;
  export let plotMode: 'value' | 'hardBin' | 'softBin' = 'value';
  export let showText = false;

  let chartEl: HTMLDivElement;
  let Plotly: typeof import('plotly.js-dist-min') | null = null;

  async function render() {
    if (!browser || !chartEl || !Plotly) return;

    const result = buildWaferMap({
      results: rows,
      waferConfig: {
        diameter,
        notch: { type: 'bottom' },
        orientation: 0,
        metadata: {
          lot: 'LOT-SVELTE',
          waferNumber: 1,
          testDate: '2026-04-21',
          testProgram: 'SK-DEMO',
          temperature: 25,
        },
      },
      dieConfig: die,
    });

    const scene = buildScene(result.wafer, result.dies, { plotMode, showText });
    const plot  = toPlotly(scene);
    await Plotly.react(chartEl, plot.data, plot.layout, { responsive: true });
  }

  onMount(async () => {
    Plotly = await import('plotly.js-dist-min');
    await render();
  });

  $: if (browser && Plotly) {
    render();
  }
</script>

<div bind:this={chartEl} style="width: 100%; min-height: 560px;"></div>
