<!--
  The call on screen (see connect/calls.svelte.ts): a ring
  card while a call comes in or goes out, then the call itself, full screen
  on phones and a floating window on bigger screens, over whatever page is
  open, so you can keep chatting or using the tools.
-->
<script lang="ts">
  import { formatDuration } from '../../core/call';
  import { displayName, getDevice, hub } from './devices.svelte';
  import { accept, calls, decline, flipCamera, hangup, hardware, toggleCam, toggleMic } from './calls.svelte';

  const call = $derived(calls.current);
  const device = $derived(call ? getDevice(call.device) : undefined);
  const name = $derived(device ? displayName(device) : 'Device');
  const initial = $derived(name.trim()[0]?.toUpperCase() ?? '?');
  let small = $state(false);
  /** Phones offer front and back cameras. */
  const canFlip = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

  /** Play a stream in a video element. */
  function play(el: HTMLVideoElement, stream: MediaStream | null) {
    const set = (s: MediaStream | null) => {
      if (el.srcObject !== s) el.srcObject = s;
      if (s) el.play().catch(() => {});
    };
    set(stream);
    return { update: set, destroy: () => (el.srcObject = null) };
  }

  const elapsed = $derived(call?.phase === 'active' ? formatDuration(hub.now - call.since) : '');
</script>

{#if call}
  {#if call.phase === 'ringing'}
    <div class="ring card" role="dialog" aria-label="{call.dir === 'in' ? 'Incoming' : 'Outgoing'} call">
      <span class="avatar pulse" aria-hidden="true">{initial}</span>
      <div class="who">
        <strong>{name}</strong>
        <span class="muted small">
          {call.dir === 'in' ? `Incoming ${call.video ? 'video' : 'voice'} call…` : `Calling (${call.video ? 'video' : 'voice'})…`}
        </span>
        {#if call.dir === 'in' && !hardware.mic && !hardware.cam}
          <span class="muted small">No microphone or camera found, so this device can't answer.</span>
        {/if}
      </div>
      {#if call.dir === 'in'}
        <div class="buttons">
          <button class="round decline" onclick={decline} aria-label="Decline" title="Decline">✕</button>
          <button class="round accept" disabled={!hardware.mic} onclick={() => accept(false)} aria-label="Answer with voice" title={hardware.mic ? 'Answer with voice' : 'No microphone found'}>📞</button>
          <button class="round accept" disabled={!hardware.cam} onclick={() => accept(true)} aria-label="Answer with video" title={hardware.cam ? 'Answer with video' : 'No camera found'}>🎥</button>
        </div>
      {:else}
        <div class="buttons">
          <button class="round decline" onclick={() => hangup('Call cancelled.')} aria-label="Cancel call" title="Cancel">✕</button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="call" class:small role="dialog" aria-label="Call with {name}">
      <div class="stage">
        <!-- Always playing, for the sound; the picture shows only while their camera is on. -->
        <video class="remote" class:hidden={!call.remoteCam} use:play={call.remote} autoplay playsinline></video>
        {#if !call.remoteCam}
          <div class="placeholder">
            <span class="avatar big" aria-hidden="true">{initial}</span>
          </div>
        {/if}
        <div class="top">
          <strong>{name}</strong>
          <span class="small">
            {call.phase === 'connecting' ? 'Connecting…' : elapsed}{call.remoteMic ? '' : ' · 🔇 muted'}
          </span>
        </div>
        {#if call.cam}
          <video class="local" class:mirror={!call.back} use:play={call.local} autoplay playsinline muted></video>
        {/if}
        <button class="resize" onclick={() => (small = !small)} aria-label={small ? 'Bigger' : 'Smaller'} title={small ? 'Bigger' : 'Smaller'}>
          {small ? '⤢' : '⤡'}
        </button>
      </div>
      <div class="controls">
        <button class="round" class:off={!call.mic} disabled={!call.local?.getAudioTracks().length} onclick={toggleMic} aria-pressed={!call.mic} title={!call.local?.getAudioTracks().length ? 'No microphone' : call.mic ? 'Mute' : 'Unmute'}>
          {call.mic ? '🎙️' : '🔇'}
        </button>
        <button class="round" class:off={!call.cam} disabled={!call.cam && !hardware.cam} onclick={toggleCam} aria-pressed={!call.cam} title={call.cam ? 'Turn camera off' : 'Turn camera on'}>
          {call.cam ? '📹' : '🚫'}
        </button>
        {#if canFlip && call.cam}
          <button class="round" onclick={flipCamera} title="Switch camera" aria-label="Switch camera">🔄</button>
        {/if}
        <button class="round decline" onclick={() => hangup()} title="Hang up" aria-label="Hang up">✕</button>
      </div>
    </div>
  {/if}
{:else if calls.ended}
  <div class="ended card" role="status">
    <span>{calls.ended.message}</span>
    <button class="mini" onclick={() => (calls.ended = null)} aria-label="Close">✕</button>
  </div>
{/if}

<style>
  .ring,
  .ended {
    position: fixed;
    z-index: 40;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    width: min(440px, calc(100vw - 32px));
    padding: 12px 14px;
    box-shadow: 0 8px 32px rgb(0 0 0 / 22%);
  }
  .ended {
    justify-content: space-between;
    font-size: 14px;
  }
  .who {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .who strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .small {
    font-size: 13px;
  }
  .buttons,
  .controls {
    display: flex;
    gap: 10px;
  }
  .avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
    font-size: 18px;
  }
  .avatar.big {
    width: 96px;
    height: 96px;
    font-size: 40px;
  }
  .pulse {
    animation: pulse 1.4s ease-out infinite;
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent);
    }
    100% {
      box-shadow: 0 0 0 14px transparent;
    }
  }
  .round {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 16%);
    color: #fff;
    font-size: 20px;
  }
  .ring .round {
    background: var(--surface-2);
    color: var(--text);
  }
  .round.off {
    background: #fff;
    color: #111;
  }
  .round:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ring .round.accept {
    background: #16a34a;
    color: #fff;
  }
  .round.decline,
  .ring .round.decline {
    background: #dc2626;
    color: #fff;
  }
  .mini {
    border: 0;
    background: none;
    color: var(--text-2);
  }
  .call {
    position: fixed;
    z-index: 40;
    right: 20px;
    bottom: 20px;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    width: min(720px, calc(100vw - 40px));
    height: min(540px, calc(100vh - 120px));
    border-radius: var(--radius);
    background: #0b0d12;
    color: #fff;
    overflow: hidden;
    box-shadow: 0 12px 48px rgb(0 0 0 / 35%);
  }
  .call.small {
    width: 280px;
    height: 260px;
  }
  .stage {
    position: relative;
    min-height: 0;
  }
  .remote {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
  .remote.hidden {
    opacity: 0;
  }
  .placeholder {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: grid;
    padding: 12px 52px 24px 14px;
    background: linear-gradient(rgb(0 0 0 / 55%), transparent);
    text-shadow: 0 1px 2px rgb(0 0 0 / 50%);
  }
  .local {
    position: absolute;
    right: 12px;
    bottom: 12px;
    width: 28%;
    max-width: 180px;
    aspect-ratio: 3 / 4;
    object-fit: cover;
    border-radius: 10px;
    background: #222;
    box-shadow: 0 2px 10px rgb(0 0 0 / 40%);
  }
  .small .local {
    width: 72px;
  }
  .mirror {
    transform: scaleX(-1);
  }
  .resize {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 35%);
    color: #fff;
    font-size: 16px;
  }
  .controls {
    justify-content: center;
    padding: 12px;
    background: #0b0d12;
  }
  .small .round {
    width: 38px;
    height: 38px;
    font-size: 16px;
  }
  /* Phones: the call takes the whole screen unless made small. */
  @media (max-width: 640px) {
    .call:not(.small) {
      inset: 0;
      width: auto;
      height: auto;
      border-radius: 0;
    }
    .call.small {
      right: 12px;
      bottom: 12px;
      width: 180px;
      height: 240px;
    }
    .ring,
    .ended {
      bottom: 12px;
    }
  }
</style>
