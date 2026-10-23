/**
 * Local share in the native apps: the devices the native side finds on the
 * network (core/local.ts), kept in step with the hub (devices.svelte.ts),
 * where each one that has a conversation is a `Device` with a
 * `LocalConnection`. Paired copies of this app always have one, so they stay
 * listed with their online or offline state; LocalSend devices get one when
 * you open them or they send you something.
 *
 * Also routes the native side's events: link messages and file transfers
 * to their device, PINs to show when another device asks to pair, and
 * "accept these files?" questions to connect/asks.svelte.ts.
 */
import * as local from '../../core/local';
import type { LocalDevice } from '../../core/local';
import { LocalConnection } from '../../core/local-connection';
import { isNativeApp } from '../../pwa/install.svelte';
import { askToAccept, withdraw } from './asks.svelte';
import { add, getDevice, handlersFor, hub, myKind, onRename, type Device } from './devices.svelte';

export const localHub = $state<{
  /** The native side answered. */
  ready: boolean;
  error: string;
  /** This device's fingerprint. */
  fingerprint: string;
  devices: LocalDevice[];
  /** A PIN to show: another device asked to pair with this one. */
  pin: { fingerprint: string; alias: string; pin: string; until: number } | null;
  /** The last pairing that ended on this side (to close the PIN), with whether it worked. */
  paired: { fingerprint: string; ok: boolean } | null;
}>({ ready: false, error: '', fingerprint: '', devices: [], pin: null, paired: null });

export const keyOf = (fingerprint: string) => `local:${fingerprint}`;

const connectionOf = (fingerprint: string) => {
  const d = getDevice(keyOf(fingerprint));
  return d?.transfer instanceof LocalConnection ? d.transfer : undefined;
};

export function viewOf(fingerprint: string): LocalDevice | undefined {
  return localHub.devices.find((d) => d.fingerprint === fingerprint);
}

/** The hub device for a local device, made if it has none yet. */
export function ensureDevice(view: LocalDevice): Device {
  const key = keyOf(view.fingerprint);
  const existing = getDevice(key);
  if (existing) return existing;
  const d = add((k) => new LocalConnection(view, localHub.fingerprint, handlersFor(k), { name: hub.me, kind: myKind }), {
    key,
    name: view.alias,
    kind: view.deviceModel ?? '',
    paired: true,
  });
  (d.transfer as LocalConnection).update(view);
  return d;
}

function apply(list: LocalDevice[]) {
  localHub.devices = list;
  for (const view of list) {
    const connection = connectionOf(view.fingerprint);
    if (connection) {
      connection.update(view);
      const d = getDevice(keyOf(view.fingerprint))!;
      // A LocalSend device's name only comes from here; ours say it themselves too (`hello`).
      if (!view.ours || !d.name) d.name = view.alias;
    } else if (view.paired && view.ours) {
      ensureDevice(view);
    }
  }
  // Devices that dropped off the list (forgotten, or a LocalSend device long gone) show as away.
  for (const d of hub.devices) {
    if (!(d.transfer instanceof LocalConnection) || list.some((v) => keyOf(v.fingerprint) === d.key)) continue;
    d.transfer.update({ ...d.transfer.device, online: false, linked: false, paired: false });
  }
}

/** Ask the other device to show a PIN; then call `enterPin` with what the person types. */
export const requestPin = (fingerprint: string) => local.pairRequest(fingerprint);

export async function enterPin(fingerprint: string, pin: string): Promise<void> {
  await local.pairEnter(fingerprint, pin);
  apply(await local.devices());
}

/** Unpair (or, for a LocalSend device, just close its conversation). */
export async function forgetDevice(fingerprint: string) {
  await local.forget(fingerprint).catch(() => {});
  const d = getDevice(keyOf(fingerprint));
  if (d) {
    d.transfer.shutdown();
    hub.devices = hub.devices.filter((x) => x !== d);
  }
  apply(await local.devices());
}

export async function refresh() {
  await local.refresh();
  apply(await local.devices());
}

let started = false;

/** Start Local share (once), in the native apps only. */
export function startLocal() {
  if (started || !isNativeApp()) return;
  started = true;
  local
    .start(hub.me, myKind)
    .then(async ({ fingerprint }) => {
      localHub.fingerprint = fingerprint;
      localHub.ready = true;
      apply(await local.devices());
    })
    .catch((e: unknown) => (localHub.error = String(e)));
  onRename((name) => local.start(name, myKind).catch(() => {}));

  local.on('local://devices', apply);
  local.on('local://link', ({ fingerprint, data }) => connectionOf(fingerprint)?.onLink(data));
  local.on('local://pair-pin', (pin) => {
    localHub.pin = pin;
    localHub.paired = null;
  });
  local.on('local://pair-done', (done) => {
    if (localHub.pin?.fingerprint === done.fingerprint) localHub.pin = null;
    localHub.paired = done;
  });
  local.on('local://ask', (ask) => {
    askToAccept({ id: ask.request, from: ask.alias, files: ask.files, stranger: !ask.paired }).then((ok) => local.answer(ask.request, ok));
  });
  local.on('local://ask-closed', ({ request }) => withdraw(request));
  local.on('local://incoming', (inc) => {
    const view = viewOf(inc.fingerprint) ?? {
      fingerprint: inc.fingerprint,
      alias: inc.alias,
      deviceModel: null,
      deviceType: null,
      ours: false,
      paired: false,
      online: true,
      linked: false,
      ip: '',
      lastSeen: Date.now(),
    };
    ensureDevice(view);
    connectionOf(inc.fingerprint)?.onIncoming(inc.session, inc.total, inc.files[0]?.name ?? '');
  });
  local.on('local://progress', (p) => connectionOf(p.fingerprint)?.onProgress(p.session, p.done, p.total, p.file));
  local.on('local://received', (r) => connectionOf(r.fingerprint)?.onReceived(r.session, r.files));
  local.on('local://cancelled', ({ session }) => {
    for (const d of hub.devices) if (d.transfer instanceof LocalConnection) d.transfer.onCancelled(session);
  });
}
