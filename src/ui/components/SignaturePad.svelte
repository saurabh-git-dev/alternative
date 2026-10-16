<!--
  Create a signature by drawing, typing or uploading. Emits a trimmed PNG
  data URL with a transparent background. The last signature can be kept on
  this device for next time.
-->
<script lang="ts">
  let { onCreate }: { onCreate: (dataUrl: string) => void } = $props();

  type Mode = 'draw' | 'type' | 'upload';
  let mode = $state<Mode>('draw');
  let color = $state('#1a237e');
  let typed = $state('');
  let font = $state('cursive');
  let canvas = $state<HTMLCanvasElement>();
  let empty = $state(true);

  const FONTS = [
    { value: 'cursive', label: 'Handwriting' },
    { value: "'Brush Script MT', 'Segoe Script', cursive", label: 'Brush' },
    { value: "'Snell Roundhand', 'Lucida Handwriting', cursive", label: 'Elegant' },
  ];

  $effect(() => {
    if (!canvas) return;
    const ratio = devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
  });

  function draw(e: PointerEvent) {
    const ctx = canvas!.getContext('2d')!;
    const rect = canvas!.getBoundingClientRect();
    const point = (ev: PointerEvent) => [ev.clientX - rect.left, ev.clientY - rect.top];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let [lx, ly] = point(e);
    ctx.beginPath();
    ctx.arc(lx, ly, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    empty = false;
    const move = (ev: PointerEvent) => {
      // Coalesced events give smooth curves on fast strokes.
      for (const p of ev.getCoalescedEvents?.() ?? [ev]) {
        const [x, y] = point(p);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.quadraticCurveTo(lx, ly, (lx + x) / 2, (ly + y) / 2);
        ctx.lineTo(x, y);
        ctx.stroke();
        [lx, ly] = [x, y];
      }
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  function clear() {
    canvas?.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    empty = true;
  }

  /** Crop to the drawn pixels plus a small margin. */
  function trimmed(source: HTMLCanvasElement): string {
    const ctx = source.getContext('2d')!;
    const { width, height } = source;
    const data = ctx.getImageData(0, 0, width, height).data;
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < x0) return '';
    const pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d')!.drawImage(source, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  function useTyped() {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 300;
    const ctx = c.getContext('2d')!;
    ctx.font = `120px ${font}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(typed.trim(), 20, 150);
    finish(trimmed(c));
  }

  async function useUpload(file: File | undefined) {
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    // Make near-white pixels transparent so scanned signatures sit cleanly on the page.
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const lum = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
      if (lum > 225) img.data[i + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);
    finish(trimmed(c));
  }

  function finish(url: string) {
    if (url) onCreate(url);
  }
</script>

<div class="pad card">
  <div class="tabs" role="tablist">
    {#each [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']] as [value, label] (value)}
      <button role="tab" aria-selected={mode === value} class:active={mode === value} onclick={() => (mode = value as Mode)}>{label}</button>
    {/each}
    <span class="spacer"></span>
    <label class="color" title="Ink colour">
      <input type="color" bind:value={color} aria-label="Ink colour" />
    </label>
  </div>

  {#if mode === 'draw'}
    <canvas bind:this={canvas} class="draw" onpointerdown={draw}></canvas>
    <div class="row">
      <span class="muted small">Sign with your mouse, finger or stylus.</span>
      <button class="btn" onclick={clear} disabled={empty}>Clear</button>
      <button class="btn btn-primary" disabled={empty} onclick={() => finish(trimmed(canvas!))}>Use this signature</button>
    </div>
  {:else if mode === 'type'}
    <input class="typed" placeholder="Type your name" bind:value={typed} style="font-family: {font}; color: {color}" />
    <div class="row">
      <select bind:value={font} aria-label="Style">
        {#each FONTS as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
      </select>
      <span class="spacer"></span>
      <button class="btn btn-primary" disabled={!typed.trim()} onclick={useTyped}>Use this signature</button>
    </div>
  {:else}
    <label class="upload">
      <input type="file" accept="image/*" hidden onchange={(e) => useUpload(e.currentTarget.files?.[0])} />
      <span>Choose a photo or scan of your signature</span>
      <span class="muted small">White backgrounds are removed automatically.</span>
    </label>
  {/if}
</div>

<style>
  .pad {
    padding: 14px;
    display: grid;
    gap: 12px;
    box-shadow: none;
  }
  .tabs {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .tabs button {
    border: none;
    background: none;
    padding: 6px 12px;
    border-radius: 8px;
    font-weight: 550;
    color: var(--text-2);
  }
  .tabs button.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .color input {
    width: 32px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .draw {
    width: 100%;
    height: 180px;
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-sm);
    background: white;
    touch-action: none;
    cursor: crosshair;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .row .muted {
    flex: 1;
  }
  .small {
    font-size: 13px;
  }
  .typed {
    width: 100%;
    font-size: 44px;
    padding: 10px 14px;
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-sm);
    background: white;
  }
  select {
    padding: 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .upload {
    display: grid;
    gap: 4px;
    place-items: center;
    padding: 40px 16px;
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: center;
  }
  .upload:hover {
    border-color: var(--accent);
  }
</style>
