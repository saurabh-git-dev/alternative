<!--
  Start, pause and stop a recording (see core/recorder.ts).

  Before: pick what to record (screen, screen + camera, camera), the
  microphone, computer sound and quality; choices are remembered. During:
  a live preview, the timer, pause/resume, stop and discard, and for
  screen + camera a button to float the camera bubble. A 3-second countdown
  gives time to switch windows.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Recorder, recorderSupport, type RecordOptions, type RecordQuality, type RecordSource } from '../../core/recorder';
  import type { RecordingMeta } from '../../core/recordings';
  import { formatTime } from '../../core/video';
  import { deviceInfo } from '../../core/device';
  import { loadRecorderOptions, saveRecorderOptions } from '../settings';
  import { openBubble } from './bubble';

  let { onSaved, onStarted }: { onSaved: (meta: RecordingMeta) => void; onStarted?: (id: string) => void } = $props();

  const support = recorderSupport();
  const phone = deviceInfo().mobile;
  const canScreen = support.screen && !phone;

  let options = $state<RecordOptions & { countdown: boolean }>(
    loadRecorderOptions({ source: canScreen ? 'both' : 'camera', mic: true, systemAudio: false, quality: '1080', countdown: true, micId: '', cameraId: '' } as RecordOptions & { countdown: boolean }),
  );
  if (!canScreen) options.source = 'camera';
  $effect(() => saveRecorderOptions($state.snapshot(options)));

  let recorder = $state<Recorder | null>(null);
  let status = $state<'idle' | 'countdown' | 'recording' | 'paused' | 'saving'>('idle');
  let count = $state(0);
  let elapsed = $state(0);
  let error = $state<string | null>(null);
  let bubbleClose: (() => void) | null = null;
  let bubbleOpen = $state(false);
  let preview = $state<HTMLVideoElement>();
  let mics = $state<MediaDeviceInfo[]>([]);
  let cameras = $state<MediaDeviceInfo[]>([]);

  /** Device names are only visible once the user has allowed access once. */
  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      mics = all.filter((d) => d.kind === 'audioinput' && d.label);
      cameras = all.filter((d) => d.kind === 'videoinput' && d.label);
    } catch {
      /* not available */
    }
  }
  untrack(() => void listDevices());

  $effect(() => {
    if (status !== 'recording' && status !== 'paused') return;
    const timer = setInterval(() => (elapsed = recorder?.elapsed() ?? 0), 250);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => {
      clearInterval(timer);
      removeEventListener('beforeunload', warn);
    };
  });

  $effect(() => {
    if (preview && recorder) preview.srcObject = recorder.preview;
  });

  async function start() {
    error = null;
    try {
      const r = await Recorder.start($state.snapshot(options));
      recorder = r;
      r.onStop = (meta) => finish(meta);
      r.onError = (message) => (error = message);
      onStarted?.(r.meta.id);
      void listDevices();
      if (options.source === 'both' && r.camera) void floatBubble();
      // Countdown after the picker, so there's time to switch to the window being recorded.
      if (options.countdown) {
        r.pause();
        status = 'countdown';
        for (count = 3; count > 0; count--) await new Promise((res) => setTimeout(res, 1000));
        if (recorder !== r) return;
        r.resume();
      }
      status = 'recording';
    } catch (e) {
      status = 'idle';
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function floatBubble() {
    if (!recorder?.camera || bubbleOpen) return;
    try {
      bubbleClose = await openBubble(recorder.camera);
      bubbleOpen = true;
    } catch {
      /* needs a click: the button below stays visible */
    }
  }

  function pauseResume() {
    if (!recorder) return;
    if (recorder.state === 'paused') recorder.resume();
    else recorder.pause();
    status = recorder.state === 'paused' ? 'paused' : 'recording';
  }

  async function stop() {
    if (!recorder) return;
    status = 'saving';
    await recorder.stop();
  }

  async function discard() {
    if (!recorder || !confirm('Throw this recording away?')) return;
    const r = recorder;
    cleanup();
    await r.discard();
    status = 'idle';
  }

  function cleanup() {
    bubbleClose?.();
    bubbleClose = null;
    bubbleOpen = false;
    recorder = null;
    elapsed = 0;
  }

  function finish(meta: RecordingMeta) {
    cleanup();
    status = 'idle';
    onSaved(meta);
  }

  const SOURCES: { value: RecordSource; label: string; icon: string; needsScreen: boolean }[] = [
    { value: 'both', label: 'Screen + camera', icon: '🧑‍💻', needsScreen: true },
    { value: 'screen', label: 'Screen', icon: '🖥️', needsScreen: true },
    { value: 'camera', label: 'Camera', icon: '📷', needsScreen: false },
  ];
  const QUALITIES: { value: RecordQuality; label: string }[] = [
    { value: '720', label: '720p' },
    { value: '1080', label: '1080p' },
    { value: '1440', label: '1440p' },
  ];
</script>

<section class="panel card" aria-label="Recorder">
  {#if !support.recorder || !support.camera}
    <p class="warn">This browser can't record video. Try a recent Chrome, Edge, Firefox or Safari.</p>
  {:else if status === 'idle'}
    <h2>New recording</h2>
    <div class="sources" role="radiogroup" aria-label="What to record">
      {#each SOURCES as s (s.value)}
        <button
          class="source"
          class:active={options.source === s.value}
          role="radio"
          aria-checked={options.source === s.value}
          disabled={s.needsScreen && !canScreen}
          onclick={() => (options.source = s.value)}
        >
          <span class="emoji" aria-hidden="true">{s.icon}</span>{s.label}
        </button>
      {/each}
    </div>
    {#if !canScreen}
      <p class="note muted">
        {phone ? 'Phone browsers can’t record the screen, so you can record with the camera here. Use a computer for screen recordings.' : 'This browser can’t record the screen; you can still record with the camera.'}
      </p>
    {:else if options.source === 'both'}
      <p class="note muted">Your camera floats in a bubble on top of everything. Share your <strong>entire screen</strong> so the bubble is in the recording.</p>
    {/if}

    <div class="options">
      <label class="toggle"><input type="checkbox" bind:checked={options.mic} /> 🎙️ Microphone</label>
      {#if options.mic && mics.length > 1}
        <select bind:value={options.micId} aria-label="Microphone">
          <option value="">Default microphone</option>
          {#each mics as m (m.deviceId)}<option value={m.deviceId}>{m.label}</option>{/each}
        </select>
      {/if}
      {#if options.source !== 'camera'}
        <label class="toggle" title="Chrome and Edge can record the sound of a tab, or of the whole computer on Windows and ChromeOS">
          <input type="checkbox" bind:checked={options.systemAudio} /> 🔊 Computer sound
        </label>
      {/if}
      {#if options.source !== 'screen' && cameras.length > 1}
        <select bind:value={options.cameraId} aria-label="Camera">
          <option value="">Default camera</option>
          {#each cameras as c (c.deviceId)}<option value={c.deviceId}>{c.label}</option>{/each}
        </select>
      {/if}
    </div>

    <div class="options">
      <span class="muted label">Quality</span>
      <div class="seg" role="radiogroup" aria-label="Quality">
        {#each QUALITIES as q (q.value)}
          <button class:active={options.quality === q.value} role="radio" aria-checked={options.quality === q.value} onclick={() => (options.quality = q.value)}>{q.label}</button>
        {/each}
      </div>
      <label class="toggle"><input type="checkbox" bind:checked={options.countdown} /> 3-second countdown</label>
    </div>

    <button class="btn btn-lg start" onclick={start}><span class="dot" aria-hidden="true"></span> Start recording</button>
    {#if phone}
      <p class="note muted">Keep this tab open while recording: phones stop recording when the browser goes to the background.</p>
    {/if}
  {:else}
    <div class="live">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={preview} muted playsinline autoplay class:mirror={options.source === 'camera'}></video>
      {#if status === 'countdown'}
        <div class="countdown" aria-live="assertive">{count}</div>
      {/if}
    </div>
    <div class="bar" aria-live="polite">
      {#if status === 'saving'}
        <span class="state">Saving…</span>
      {:else}
        <span class="state" class:paused={status === 'paused'}><span class="dot" aria-hidden="true"></span>{status === 'paused' ? 'Paused' : status === 'countdown' ? 'Get ready' : 'Recording'}</span>
        <span class="clock">{formatTime(elapsed)}</span>
        <span class="spacer"></span>
        {#if options.source === 'both' && !bubbleOpen && status !== 'countdown'}
          <button class="btn" onclick={floatBubble} title="Float the camera on top of other windows">🫧 Show camera bubble</button>
        {/if}
        <button class="btn" onclick={pauseResume} disabled={status === 'countdown'}>{status === 'paused' ? '▶ Resume' : '⏸ Pause'}</button>
        <button class="btn" onclick={discard} disabled={status === 'countdown'} title="Stop and delete">🗑</button>
        <button class="btn btn-primary" onclick={stop} disabled={status === 'countdown'}>■ Stop</button>
      {/if}
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .panel {
    padding: 18px;
    display: grid;
    gap: 14px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .sources {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .source {
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 12px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    font-weight: 550;
    font-size: 14px;
  }
  .source .emoji {
    font-size: 24px;
  }
  .source.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .source:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: center;
    font-size: 14.5px;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .label {
    font-size: 14px;
  }
  select {
    max-width: 240px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .seg button {
    padding: 5px 12px;
    border: 0;
    border-radius: 7px;
    background: none;
    font-size: 13.5px;
    font-weight: 550;
    color: var(--text-2);
  }
  .seg button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .start {
    background: #dc2626;
    border-color: #dc2626;
    color: white;
  }
  .start:hover:not(:disabled) {
    background: #b91c1c;
    border-color: #b91c1c;
  }
  .start .dot {
    background: white;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #dc2626;
  }
  .note {
    margin: -4px 0 0;
    font-size: 13.5px;
  }
  .live {
    position: relative;
    display: grid;
    place-items: center;
    border-radius: var(--radius);
    background: #0b0c10;
    overflow: hidden;
  }
  .live video {
    display: block;
    width: 100%;
    max-height: 48vh;
    object-fit: contain;
  }
  .mirror {
    transform: scaleX(-1);
  }
  .countdown {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 45%);
    color: white;
    font-size: 96px;
    font-weight: 800;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .bar .btn {
    padding: 8px 14px;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
  }
  .state:not(.paused) .dot {
    animation: blink 1.2s infinite;
  }
  .state.paused .dot {
    background: var(--warning);
  }
  .clock {
    font-variant-numeric: tabular-nums;
    font-size: 18px;
    font-weight: 650;
  }
  .spacer {
    flex: 1;
  }
  .warn {
    margin: 0;
    color: var(--warning);
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 14px;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  @media (max-width: 560px) {
    .source {
      font-size: 12.5px;
      padding: 10px 4px;
    }
    .spacer {
      flex-basis: 100%;
      order: 1;
      height: 0;
    }
    .bar .btn {
      order: 2;
    }
  }
</style>
