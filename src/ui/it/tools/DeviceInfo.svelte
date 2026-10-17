<!--
  Device information: what this browser reports about the screen, browser,
  language and hardware. Handy for bug reports; "📱 QR" or "📡 Send" passes
  the whole list to another device.
-->
<script lang="ts">
  import type { ItToolProps } from '../../../it/types';
  import type { OutputRow } from '../../../it/types';
  import CopyButton from '../CopyButton.svelte';
  import OutputActions from '../OutputActions.svelte';

  // Takes no starting input, but accepts the props every IT tool gets.
  let _props: ItToolProps = $props();

  let size = $state({ w: innerWidth, h: innerHeight });
  $effect(() => {
    const onResize = () => (size = { w: innerWidth, h: innerHeight });
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  });

  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string; mobile?: boolean } };
  const rows = $derived<OutputRow[]>(
    [
      { label: 'Screen', value: `${screen.width} × ${screen.height} px` },
      { label: 'Window', value: `${size.w} × ${size.h} px` },
      { label: 'Pixel ratio', value: String(devicePixelRatio) },
      { label: 'Colour depth', value: `${screen.colorDepth}-bit` },
      { label: 'Orientation', value: screen.orientation?.type ?? '' },
      { label: 'Platform', value: nav.userAgentData?.platform ?? navigator.platform },
      { label: 'Mobile', value: nav.userAgentData?.mobile === undefined ? '' : nav.userAgentData.mobile ? 'yes' : 'no' },
      { label: 'Touch points', value: String(navigator.maxTouchPoints) },
      { label: 'CPU cores', value: String(navigator.hardwareConcurrency ?? '') },
      { label: 'Memory', value: nav.deviceMemory ? `≥ ${nav.deviceMemory} GB (rounded by the browser)` : '' },
      { label: 'Languages', value: navigator.languages.join(', ') },
      { label: 'Time zone', value: Intl.DateTimeFormat().resolvedOptions().timeZone },
      { label: 'Dark mode', value: matchMedia('(prefers-color-scheme: dark)').matches ? 'preferred' : 'not preferred' },
      { label: 'Reduced motion', value: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'yes' : 'no' },
      { label: 'Cookies', value: navigator.cookieEnabled ? 'enabled' : 'disabled' },
      { label: 'Online', value: navigator.onLine ? 'yes' : 'no' },
      { label: 'Cross-origin isolated', value: crossOriginIsolated ? 'yes (multi-threaded WASM)' : 'no' },
      { label: 'User agent', value: navigator.userAgent },
    ].filter((r) => r.value),
  );
  const text = $derived(rows.map((r) => `${r.label}: ${r.value}`).join('\n'));
</script>

<section class="card it-pane">
  <div class="it-pane-head"><h2>This device</h2><OutputActions {text} name="device-info" /></div>
  <dl class="it-rows">
    {#each rows as row (row.label)}
      <div class="it-row"><dt>{row.label}</dt><dd>{row.value}</dd><CopyButton text={row.value} /></div>
    {/each}
  </dl>
</section>
