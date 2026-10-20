/**
 * Voice and video calls between two connected devices (see core/direct.ts).
 *
 * A call doesn't open a new connection. Its audio and video are added to the
 * WebRTC connection the devices already share, whose certificates both sides
 * checked against the QR code's secret, so the call is as private as the
 * chat: straight between the devices (or through the same blind relay),
 * encrypted by WebRTC, and nobody else can join or listen in.
 *
 * Signalling goes over the chat's sealed channel as `sig` messages:
 * - `ring` {id, video} asks the other device to pick up; it answers with
 *   `accept` or `decline` (reason `declined`, `busy` or `unavailable`).
 *   Either side ends it with `hangup`.
 * - `sdp` carries the offer and answer that add the media. The host always
 *   makes the offer, so the two sides never offer at once. The first call on
 *   a connection adds one audio and one video slot (transceiver) both ways;
 *   later calls on it reuse them, so they start with no new offer.
 * - `media` {audio, video} says whether this side's mic and camera are on,
 *   so the other side can show a placeholder instead of a frozen picture.
 * - Turning the camera on during a voice call, or switching cameras, swaps
 *   the track in place (`replaceTrack`), with no new offer either.
 */
import type { Role } from './direct-crypto';

export type SignalKind = 'ring' | 'accept' | 'decline' | 'hangup' | 'sdp' | 'media';

export interface Signal {
  c: SignalKind;
  id: string;
  video?: boolean;
  audio?: boolean;
  reason?: 'declined' | 'busy' | 'unavailable';
  sdp?: RTCSessionDescriptionInit;
}

const KINDS: SignalKind[] = ['ring', 'accept', 'decline', 'hangup', 'sdp', 'media'];
const REASONS = ['declined', 'busy', 'unavailable'];

/** A well-formed call signal, or null for anything else. */
export function parseSignal(data: unknown): Signal | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (!KINDS.includes(d.c as SignalKind) || typeof d.id !== 'string' || !d.id || d.id.length > 64) return null;
  const signal: Signal = { c: d.c as SignalKind, id: d.id };
  if (typeof d.video === 'boolean') signal.video = d.video;
  if (typeof d.audio === 'boolean') signal.audio = d.audio;
  if (typeof d.reason === 'string' && REASONS.includes(d.reason)) signal.reason = d.reason as Signal['reason'];
  if (signal.c === 'sdp') {
    const sdp = d.sdp as Record<string, unknown> | undefined;
    if (!sdp || (sdp.type !== 'offer' && sdp.type !== 'answer') || typeof sdp.sdp !== 'string') return null;
    signal.sdp = { type: sdp.type, sdp: sdp.sdp };
  }
  return signal;
}

/** "2:05", or "1:02:05" past an hour. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

interface Slots {
  audio: RTCRtpTransceiver;
  video: RTCRtpTransceiver;
}

/** Audio and video slots already on a connection, kept for its later calls. */
const slotsOf = new WeakMap<RTCPeerConnection, Slots>();

/** The slots the host's offer added, as they appear on the guest's side. */
function findSlots(pc: RTCPeerConnection): Slots | undefined {
  const live = pc.getTransceivers().filter((t) => t.currentDirection !== 'stopped' && t.mid !== null);
  const audio = live.find((t) => t.receiver.track.kind === 'audio');
  const video = live.find((t) => t.receiver.track.kind === 'video');
  return audio && video ? { audio, video } : undefined;
}

/**
 * The media side of one call: this device's camera and mic going out over
 * `pc`, and the other device's coming in (`remote`).
 */
export class CallMedia {
  readonly remote = new MediaStream();
  private local: MediaStream | null = null;
  private slots: Slots | undefined;
  private stopped = false;

  constructor(
    private pc: RTCPeerConnection,
    private role: Role,
    private send: (sdp: RTCSessionDescriptionInit) => void,
  ) {
    this.slots = slotsOf.get(pc);
  }

  /** Start sending `local`. The host adds the slots on a connection's first call, and offers them. */
  async start(local: MediaStream) {
    this.local = local;
    if (this.role === 'host') {
      if (!this.slots) {
        this.slots = {
          audio: this.pc.addTransceiver('audio', { direction: 'sendrecv' }),
          video: this.pc.addTransceiver('video', { direction: 'sendrecv' }),
        };
        slotsOf.set(this.pc, this.slots);
      }
      await this.attach();
      // Offered again if an earlier call ended before the other side answered.
      if (this.slots.audio.currentDirection == null) {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.send(this.pc.localDescription!.toJSON());
      }
      return;
    }
    // The guest waits for the host's offer unless an earlier call left the slots in place.
    if (this.slots) await this.attach();
  }

  /** An offer (guest) or answer (host) from the other device. */
  async onSdp(sdp: RTCSessionDescriptionInit) {
    if (this.stopped) return;
    if (sdp.type === 'answer') {
      if (this.role === 'host' && this.pc.signalingState === 'have-local-offer') await this.pc.setRemoteDescription(sdp);
      return;
    }
    if (this.role !== 'guest') return;
    await this.pc.setRemoteDescription(sdp);
    this.slots = findSlots(this.pc);
    if (this.slots) {
      slotsOf.set(this.pc, this.slots);
      this.slots.audio.direction = 'sendrecv';
      this.slots.video.direction = 'sendrecv';
      await this.attach();
    }
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.send(this.pc.localDescription!.toJSON());
  }

  /** Put this side's tracks in the slots, and show the other side's. */
  private async attach() {
    if (!this.slots || this.stopped) return;
    await this.slots.audio.sender.replaceTrack(this.local?.getAudioTracks()[0] ?? null);
    await this.slots.video.sender.replaceTrack(this.local?.getVideoTracks()[0] ?? null);
    for (const t of [this.slots.audio, this.slots.video]) {
      const track = t.receiver.track;
      if (!this.remote.getTracks().includes(track)) this.remote.addTrack(track);
    }
  }

  /** This side's tracks being sent now. */
  get tracks(): MediaStreamTrack[] {
    return this.local?.getTracks() ?? [];
  }

  /** Swap this side's camera (a new one, or none) without a new offer. */
  async setVideo(track: MediaStreamTrack | null) {
    if (!this.local) return;
    for (const old of this.local.getVideoTracks()) {
      if (old === track) continue;
      this.local.removeTrack(old);
      old.stop();
    }
    if (track && !this.local.getTracks().includes(track)) this.local.addTrack(track);
    await this.slots?.video.sender.replaceTrack(track);
  }

  /** Stop sending. The slots stay on the connection for the next call. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const t of this.local?.getTracks() ?? []) t.stop();
    if (this.slots && this.pc.connectionState !== 'closed') {
      this.slots.audio.sender.replaceTrack(null).catch(() => {});
      this.slots.video.sender.replaceTrack(null).catch(() => {});
    }
  }
}

/** Plain-language message for a failed camera or mic request. */
export function explainMediaError(error: unknown, video: boolean): string {
  const name = (error as { name?: string })?.name;
  const what = video ? 'camera' : 'microphone';
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Allow this page to use your ${what} to make calls.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} found on this device.`;
  if (name === 'NotReadableError') return `Your ${what} is in use by another app.`;
  if (typeof navigator !== 'undefined' && !navigator.mediaDevices) return 'This browser can only make calls on a secure (https) page.';
  return error instanceof Error ? error.message : `Couldn't start your ${what}.`;
}
