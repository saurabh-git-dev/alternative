# Local share

Local share is a tab of Connect in the Windows, Linux and Android apps (`#/local`,
`src/ui/connect/LocalPage.svelte`). It finds devices on the same network
and talks to them directly, with no internet and no server. It sits next to
the usual Connect tab (`#/connect`, a QR code and WebRTC through a
matchmaker), which works the same as before in the apps and on the site.

- **Nearby** lists every device on the network right now: other copies of
  this app and [LocalSend](https://localsend.org) apps.
- **Pairing** with another copy of this app takes a 6-digit PIN once. The
  device then stays under **Saved devices**, online or offline, with a chat
  for text, files of any size, and voice and video calls.
- **LocalSend** devices can be sent files straight away (their owner
  accepts), and can send files here.
- Files arriving from a device you haven't paired, or over 1 GB from any
  device, ask first. The 1 GB question also applies to Connect (WebRTC).
- Received files are saved to `Downloads/Tools` (computers) or `Download`
  (Android). Files up to 256 MB also load into the chat for preview and the
  tools; every file has **Show in folder**.

## Pieces

| Where | What |
|---|---|
| `src-tauri/src/local/` | the native service: discovery, HTTPS server and client, pairing, link, transfers |
| `src/core/local.ts` | the page's calls (`invoke('local_…')`) and events (`local://…`) |
| `src/core/connection.ts` | `Connection`: what the chat, files and calls need from a link, whatever carries it |
| `src/core/direct.ts` | `DirectTransfer`, the WebRTC `Connection` |
| `src/core/local-connection.ts` | `LocalConnection`, the Local share `Connection` |
| `src/ui/connect/local.svelte.ts` | keeps local devices in the shared device list; routes events |
| `src/ui/connect/asks.svelte.ts`, `AskDialog.svelte` | "Accept these files?" for both kinds of connection |

The chat, notices and calls (`devices.svelte.ts`, `Chat.svelte`,
`calls.svelte.ts`) only use `Connection`, so a feature added there works
over both.

## Protocol

The service speaks [LocalSend protocol v2](https://github.com/localsend/protocol),
so LocalSend apps see this app as one of their own, and adds a few routes of
its own under `/api/tools/v1/`.

- **Identity.** Each install makes a self-signed certificate once
  (`identity.rs`). Its SHA-256 is the device's fingerprint, as in LocalSend.
- **Discovery** (`discovery.rs`). A JSON announcement goes to multicast
  `224.0.0.167:53317` at start and every 30 s; devices that hear it answer
  with `POST /api/localsend/v2/register` over HTTPS. **Refresh** also asks
  every address on the local /24 networks, for Wi-Fi that drops multicast.
  The announcement carries `"tools": 1` so copies of this app know each
  other; LocalSend ignores unknown fields.
- **TLS** (`tls.rs`). Certificates aren't signed by anyone, so the check is
  the fingerprint: after connecting, the client compares the server's
  certificate with the fingerprint it expects. Clients also present their
  own certificate, so the server knows which device is calling.
- **Pairing** (`pair.rs`). The device you pick shows a PIN; you type it on
  this one. Both run SPAKE2 with the PIN and both fingerprints, then confirm
  with HMACs, so the PIN never crosses the network and a device in the
  middle can't pair as either side. 3 tries; the PIN lasts 3 minutes. Both
  sides then save each other in `paired.json`.
- **Link** (`link.rs`). Paired devices keep one connection open
  (`GET /api/tools/v1/link`, upgraded) carrying JSON messages: chat text,
  names, and call signalling. The device with the smaller fingerprint dials,
  every 5 s while it's down; a ping every 15 s keeps it alive. A device is
  online while its link is up.
- **Files** (`send.rs`, `server.rs`) use LocalSend's `prepare-upload` and
  `upload`, to any device. The page streams each file to the native side in
  4 MB pieces, which streams them on, so size doesn't matter. Paired devices
  accept straight away unless the batch is over 1 GB.
- **Calls** use WebRTC between the two apps, signalled over the link, with
  no STUN or TURN servers: on the same network the devices reach each other
  directly.

## Trying it locally

`cargo test --lib` (in `src-tauri/`) runs two services in one process that
pair, link and send files to each other, and checks that an unpaired sender
is asked first. To run two apps on one computer, give the second its own
data folder: `TOOLS_LOCAL_DIR=/tmp/tools-b npm run tauri dev`.
