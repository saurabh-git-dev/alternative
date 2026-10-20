/**
 * Voice and video calls with connected devices, on the hidden `chat/` page
 * only (see core/call.ts for how the media travels). One call at a time: a
 * device that rings during a call hears "busy".
 *
 * - Calling: this side turns on its mic (and camera), then rings. The other
 *   side has 45 seconds to pick up, as a voice or video call.
 * - A call keeps the session from closing as idle, and ends if the
 *   connection drops (a reconnect is a new connection, so call again).
 * - Each call leaves a line in that device's chat: how long it lasted, or
 *   that it was missed or declined.
 * - A voice call needs a microphone; a video call needs a camera, and uses
 *   the microphone too if there is one. Buttons for calls this device can't
 *   make (or answer) are turned off.
 */
import { CallMedia, explainMediaError, formatDuration, parseSignal, type Signal } from '../../core/call';
import type { ConnectionState } from '../../core/direct';
import { displayName, getDevice, listenForCalls, logCall, signalDevice, touchDevice } from './devices.svelte';

const RING_FOR_MS = 45_000;

export interface Call {
  /** The device on the other end. */
  device: string;
  id: string;
  /** Who rang. */
  dir: 'in' | 'out';
  /** Ringing (either way), joining media, or talking. */
  phase: 'ringing' | 'connecting' | 'active';
  /** Rung as a video call. */
  video: boolean;
  /** When it was picked up. */
  since: number;
  local: MediaStream | null;
  remote: MediaStream | null;
  mic: boolean;
  cam: boolean;
  /** The other side's mic and camera, as it last said. */
  remoteMic: boolean;
  remoteCam: boolean;
  /** Using the back camera (phones). */
  back: boolean;
}

export const calls = $state<{
  current: Call | null;
  /** Why the last call ended, shown briefly; or why it couldn't start. */
  ended: { device: string; message: string } | null;
}>({ current: null, ended: null });

let media: CallMedia | null = null;
let ringTimer: ReturnType<typeof setTimeout> | undefined;
let keepAlive: ReturnType<typeof setInterval> | undefined;
let endedTimer: ReturnType<typeof setTimeout> | undefined;
let ringer: { stop: () => void } | null = null;

const kindOf = (call: Call) => (call.video ? 'video call' : 'voice call');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Whether this device has a microphone and a camera (assumed until checked). */
export const hardware = $state({ mic: true, cam: true });

async function checkDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    hardware.mic = list.some((d) => d.kind === 'audioinput');
    hardware.cam = list.some((d) => d.kind === 'videoinput');
  } catch {
    /* can't tell: leave the buttons on and let the call itself say what's missing */
  }
}

const videoConstraints = (back: boolean): MediaTrackConstraints => ({ facingMode: back ? 'environment' : 'user', width: { ideal: 1280 }, height: { ideal: 720 } });

/** Mic for a voice call; camera, plus the mic if there is one, for a video call. */
async function getMedia(video: boolean, back = false): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can only make calls on a secure (https) page.');
  const audio = { echoCancellation: true, noiseSuppression: true };
  if (!video) return navigator.mediaDevices.getUserMedia({ audio });
  if (hardware.mic) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: videoConstraints(back) });
    } catch {
      // No usable mic (missing, busy or not allowed): the camera alone still makes a video call.
    }
  }
  return navigator.mediaDevices.getUserMedia({ video: videoConstraints(back) });
}

/** Just a camera, front or back, for turning it on or switching mid-call. */
async function getCamera(back: boolean): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(back) });
  return stream.getVideoTracks()[0];
}

function send(call: Call, signal: Omit<Signal, 'id'>): boolean {
  return signalDevice(call.device, { ...signal, id: call.id });
}

function showEnded(device: string, message: string) {
  clearTimeout(endedTimer);
  calls.ended = { device, message };
  endedTimer = setTimeout(() => (calls.ended = null), 6_000);
}

/** Tidy up after a call, log it in the chat, and say why it ended. */
function finish(message: string, log?: string) {
  const call = calls.current;
  if (!call) return;
  clearTimeout(ringTimer);
  clearInterval(keepAlive);
  ringer?.stop();
  ringer = null;
  media?.stop();
  media = null;
  for (const t of call.local?.getTracks() ?? []) t.stop();
  calls.current = null;
  const kind = kindOf(call);
  const text =
    log ??
    (call.phase === 'active'
      ? `${cap(kind)} · ${formatDuration(Date.now() - call.since)}`
      : call.dir === 'in'
        ? `Missed ${kind}`
        : `${cap(kind)} · no answer`);
  logCall(call.device, call.dir, `${call.video ? '🎥' : '📞'} ${text}`);
  showEnded(call.device, message);
}

/** The media is on its way: hook it up to the connection. */
async function join(call: Call) {
  const d = getDevice(call.device);
  const pc = d?.transfer.peerConnection;
  if (!d || !pc || !call.local) return finish('The connection to the other device was lost.');
  call.phase = 'connecting';
  const callMedia = new CallMedia(pc, d.transfer.role, (sdp) => send(call, { c: 'sdp', sdp }));
  media = callMedia;
  call.remote = callMedia.remote;
  try {
    await callMedia.start(call.local);
  } catch (e) {
    if (media === callMedia) hangup(`The call couldn't start: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (calls.current?.id !== call.id) return;
  call.phase = 'active';
  call.since = Date.now();
  sendMediaState(call);
  keepAlive = setInterval(() => touchDevice(call.device), 30_000);
}

function sendMediaState(call: Call) {
  send(call, { c: 'media', audio: call.mic, video: call.cam });
}

/** Ring a connected device. */
export async function startCall(device: string, video: boolean) {
  if (calls.current) return;
  const d = getDevice(device);
  if (d?.conn.state !== 'connected') return showEnded(device, 'Wait for the device to connect, then call.');
  const call: Call = {
    device,
    id: crypto.randomUUID(),
    dir: 'out',
    phase: 'ringing',
    video,
    since: 0,
    local: null,
    remote: null,
    mic: true,
    cam: video,
    remoteMic: true,
    remoteCam: false,
    back: false,
  };
  calls.current = call;
  calls.ended = null;
  let local: MediaStream;
  try {
    local = await getMedia(video);
  } catch (e) {
    calls.current = null;
    return showEnded(device, explainMediaError(e, video));
  }
  if (calls.current?.id !== call.id) {
    for (const t of local.getTracks()) t.stop();
    return;
  }
  calls.current.local = local;
  calls.current.mic = local.getAudioTracks().length > 0;
  if (!send(call, { c: 'ring', video })) return finish('The connection to the other device was lost.', `${cap(kindOf(call))} · couldn't connect`);
  ringTimer = setTimeout(() => {
    if (calls.current?.id !== call.id || calls.current.phase !== 'ringing') return;
    send(call, { c: 'hangup' });
    finish(`${displayName(getDevice(device)!)} didn't answer.`);
  }, RING_FOR_MS);
}

/** Pick up a ringing call, as a voice or video call. */
export async function accept(video: boolean) {
  const call = calls.current;
  if (!call || call.dir !== 'in' || call.phase !== 'ringing') return;
  clearTimeout(ringTimer);
  ringer?.stop();
  ringer = null;
  call.phase = 'connecting';
  let local: MediaStream;
  try {
    local = await getMedia(video);
  } catch (e) {
    send(call, { c: 'decline', reason: 'declined' });
    return finish(explainMediaError(e, video), `Missed ${kindOf(call)}`);
  }
  if (calls.current?.id !== call.id) {
    for (const t of local.getTracks()) t.stop();
    return;
  }
  const live = calls.current;
  live.local = local;
  live.cam = video;
  live.mic = local.getAudioTracks().length > 0;
  send(live, { c: 'accept', video });
  await join(live);
}

export function decline() {
  const call = calls.current;
  if (!call || call.dir !== 'in' || call.phase !== 'ringing') return;
  send(call, { c: 'decline', reason: 'declined' });
  finish('Call declined.', `Declined ${kindOf(call)}`);
}

/** End the call (or stop ringing). */
export function hangup(message = 'Call ended.') {
  const call = calls.current;
  if (!call) return;
  send(call, { c: 'hangup' });
  finish(message);
}

export function toggleMic() {
  const call = calls.current;
  if (!call?.local?.getAudioTracks().length) return;
  call.mic = !call.mic;
  for (const t of call.local.getAudioTracks()) t.enabled = call.mic;
  sendMediaState(call);
}

/** Turn the camera on or off. Off stops it (its light goes out); on asks for it again. */
export async function toggleCam() {
  const call = calls.current;
  if (!call?.local || !media) return;
  if (call.cam) {
    call.cam = false;
    await media.setVideo(null);
    call.local = new MediaStream(media.tracks);
  } else {
    try {
      const track = await getCamera(call.back);
      if (calls.current?.id !== call.id || !media) return track.stop();
      await media.setVideo(track);
      call.cam = true;
      // A fresh stream object, so the preview picks up the new track.
      call.local = new MediaStream(media.tracks);
    } catch (e) {
      return showEnded(call.device, explainMediaError(e, true));
    }
  }
  sendMediaState(call);
}

/** Switch between the front and back cameras (phones). */
export async function flipCamera() {
  const call = calls.current;
  if (!call?.local || !media || !call.cam) return;
  const back = !call.back;
  try {
    // Phones often can't open both cameras at once: let go of the current one first.
    for (const t of call.local.getVideoTracks()) t.stop();
    const track = await getCamera(back);
    if (calls.current?.id !== call.id || !media) return track.stop();
    await media.setVideo(track);
    call.back = back;
    call.local = new MediaStream(media.tracks);
  } catch (e) {
    // The old camera is already off.
    if (media) await media.setVideo(null).catch(() => {});
    call.cam = false;
    if (media) call.local = new MediaStream(media.tracks);
    sendMediaState(call);
    showEnded(call.device, explainMediaError(e, true));
  }
}

/** A short two-tone ring while a call comes in (and a buzz on phones). */
function ring(): { stop: () => void } {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    /* no audio: the screen still shows the call */
  }
  const beep = () => {
    navigator.vibrate?.([300, 200, 300]);
    if (!ctx || ctx.state === 'closed') return;
    const t = ctx.currentTime;
    for (const [freq, at] of [
      [880, 0],
      [660, 0.25],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.15, t + at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.25);
    }
  };
  beep();
  const timer = setInterval(beep, 2_000);
  return {
    stop: () => {
      clearInterval(timer);
      navigator.vibrate?.(0);
      ctx?.close().catch(() => {});
    },
  };
}

function onSignal(device: string, data: unknown) {
  const signal = parseSignal(data);
  if (!signal) return;
  const call = calls.current;
  if (signal.c === 'ring') {
    if (call) {
      // Already on a call (or the same ring again after a reconnect).
      if (call.id !== signal.id) signalDevice(device, { c: 'decline', id: signal.id, reason: 'busy' });
      return;
    }
    touchDevice(device);
    calls.ended = null;
    calls.current = {
      device,
      id: signal.id,
      dir: 'in',
      phase: 'ringing',
      video: !!signal.video,
      since: 0,
      local: null,
      remote: null,
      mic: true,
      cam: false,
      remoteMic: true,
      remoteCam: !!signal.video,
      back: false,
    };
    ringer = ring();
    ringTimer = setTimeout(() => calls.current?.id === signal.id && calls.current.phase === 'ringing' && finish('Missed call.'), RING_FOR_MS);
    return;
  }
  if (!call || call.id !== signal.id || call.device !== device) return;
  switch (signal.c) {
    case 'accept':
      if (call.dir === 'out' && call.phase === 'ringing') {
        clearTimeout(ringTimer);
        call.remoteCam = !!signal.video;
        join(call);
      }
      break;
    case 'decline': {
      const name = displayName(getDevice(device)!);
      if (signal.reason === 'busy') finish(`${name} is on another call.`, `${cap(kindOf(call))} · busy`);
      else if (signal.reason === 'unavailable') finish(`${name} can take calls once it opens this chat page.`, `${cap(kindOf(call))} · not on the chat page`);
      else finish(`${name} declined the call.`, `${cap(kindOf(call))} · declined`);
      break;
    }
    case 'hangup':
      finish(call.phase === 'ringing' && call.dir === 'in' ? 'Missed call.' : 'Call ended.');
      break;
    case 'sdp':
      media?.onSdp(signal.sdp!).catch((e) => hangup(`The call couldn't connect: ${e instanceof Error ? e.message : String(e)}`));
      break;
    case 'media':
      call.remoteMic = signal.audio ?? call.remoteMic;
      call.remoteCam = signal.video ?? call.remoteCam;
      break;
  }
}

function onState(device: string, state: ConnectionState) {
  const call = calls.current;
  if (call?.device === device && state.state !== 'connected') finish('The call dropped because the connection was lost.');
}

let enabled = false;

/** Take calls on this page. */
export function enableCalls() {
  if (enabled || typeof window === 'undefined') return;
  enabled = true;
  listenForCalls({ signal: onSignal, state: onState });
  checkDevices();
  // Labels and the full list show up once the page may use them, and devices come and go.
  navigator.mediaDevices?.addEventListener('devicechange', checkDevices);
  addEventListener('pagehide', () => calls.current && hangup());
}
