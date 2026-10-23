/**
 * What the chat, files and calls need from a link to another device, so they
 * work the same over every way of connecting:
 * - `DirectTransfer` (core/direct.ts): WebRTC through the internet, paired by
 *   QR code, in the browser and the apps.
 * - `LocalConnection` (core/local-connection.ts): the native apps' Local
 *   share, straight over the local network, paired by PIN (or a LocalSend
 *   device, which only takes files).
 * Both report to the same `Handlers` (core/direct.ts).
 */
import type { Role } from './direct-crypto';

export interface Connection {
  readonly kind: 'webrtc' | 'local';
  /** Which side makes the offer when a call adds audio and video (see core/call.ts). */
  readonly role: Role;
  /** Where a call's audio and video go; null while the devices aren't connected. */
  readonly peerConnection: RTCPeerConnection | null;
  /** Queue files to send; returns the batch id used in progress events. */
  send(files: File[]): string;
  /** Send a text message (re-sent until confirmed); returns its id. */
  sendText(text: string, id?: string): string;
  /** Call signalling, now; false if it can't go right now. */
  signal(data: object): boolean;
  /** This device's name changed. */
  rename(name: string): void;
  /** Close the conversation for both sides. */
  end(reason?: 'idle'): void | Promise<void>;
  /** Drop the connection without telling the other side (e.g. leaving the page). */
  shutdown(): void;
}
