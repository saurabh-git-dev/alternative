<!--
  Screen recorder home: the recorder on top, the library of saved
  recordings below. A new recording appears in the library while it's
  finalised (seek index, thumbnail), then opens in the player.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { listRecordings, recoverInterrupted, type RecordingMeta } from '../../core/recordings';
  import RecorderPanel from './RecorderPanel.svelte';
  import RecordingLibrary from './RecordingLibrary.svelte';
  import { finalizeRecording } from './finalize';
  import { VIDEO_HOME } from '../section';

  let recordings = $state<RecordingMeta[]>([]);
  let busy = $state<string[]>([]);
  let openId = $state<string | null>(null);
  let active: string | undefined;
  let error = $state<string | null>(null);

  async function refresh() {
    try {
      recordings = await listRecordings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  untrack(async () => {
    try {
      // Anything left mid-recording by a closed or crashed tab becomes a normal entry.
      for (const meta of await recoverInterrupted(active)) void finalize(meta, false);
    } catch {
      /* storage unavailable: shown by refresh */
    }
    await refresh();
  });

  async function finalize(meta: RecordingMeta, open: boolean) {
    busy = [...busy, meta.id];
    await refresh();
    try {
      await finalizeRecording(meta);
    } finally {
      busy = busy.filter((id) => id !== meta.id);
      await refresh();
    }
    if (open) openId = meta.id;
  }
</script>

<section class="hero">
  <h1>Record your screen, right in your browser</h1>
  <p class="muted">Screen, camera and microphone, like Loom. Recordings are saved in this browser and never uploaded.</p>
</section>

<div class="layout">
  <RecorderPanel onStarted={(id) => (active = id)} onSaved={(meta) => finalize(meta, true)} />
  {#if error}
    <p class="error" role="alert">Recordings can't be saved here: {error}</p>
  {/if}
  <RecordingLibrary bind:recordings {busy} bind:openId />
  <p class="muted more">Need to trim, blur or compress a recording? Use <strong>Edit</strong> on it, or open the <a href={VIDEO_HOME}>video tools</a>.</p>
</div>

<style>
  .hero {
    text-align: center;
    padding: 4px 0 16px;
  }
  h1 {
    font-size: clamp(21px, 3vw, 30px);
    line-height: 1.2;
    margin: 0 0 4px;
    letter-spacing: -0.02em;
  }
  .hero p {
    margin: 0;
    font-size: 14.5px;
  }
  .layout {
    display: grid;
    gap: 24px;
    max-width: 960px;
    margin: 0 auto;
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 14px;
  }
  .more {
    margin: 0;
    text-align: center;
    font-size: 14px;
  }
  @media (max-width: 560px) {
    .hero p {
      display: none;
    }
  }
</style>
