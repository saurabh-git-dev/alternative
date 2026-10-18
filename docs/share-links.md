# Share links and QR codes

`#/share` turns a file, or pasted text, CSV or JSON, into a link that
*contains* the file. Opening the link (or scanning its QR code) loads the app,
which unpacks the file and offers to save it. No server stores anything.

Code: `src/core/share.ts` (format, pure functions, unit-tested in
`tests/share.test.ts`), `src/ui/pages/Share.svelte` (create),
`src/ui/pages/Received.svelte` (open), `src/ui/components/QrCode.svelte`.

## Format

```
<app>#/s/<base64url>   copyable link (shortest text)
<app>#/q/<base43>      QR form (denser inside a QR code)
```

Data lives in the URL **fragment** (after `#`), which browsers never send to
the server, so GitHub Pages only serves the app itself.

Both forms carry the same packed bytes: a format byte (1 stored / 2 deflate,
whichever is smaller), a one-byte type code for common types (text, CSV,
JSON, PDF, JPEG, PNG, WebP, AVIF, GIF, SVG; other types are spelled out),
the file name (optional), then the file.

Why two encodings: QR codes have an *alphanumeric* mode (`0-9 A-Z $%*+-./:`
and space) that stores 5.5 bits per character instead of 8. The QR form
uses 43 of those characters (no space or `%`, which would break a URL), two
bytes per three characters, like base45. The URL prefix goes in a byte-mode
segment and the payload in an alphanumeric segment, which fits ~29% more
data than base64 in one code.

## Limits

| | Capacity |
|---|---|
| One QR code, "Normal" error correction (L) | ~2.8 KB packed |
| "Sturdier" (M) / "Sturdiest" (Q) | ~2.2 KB / ~1.6 KB |
| Link | ~1.5 MB file; above 64 K characters some apps truncate links |

Text, CSV and JSON compress well (often 4–10×). Images and PDFs are already
compressed, so a photo needs **Shrink image to fit the QR code**: it
re-encodes as AVIF at the largest size that reaches reasonable quality
(`fitToBytes` in `src/engines/image.ts`). The original is untouched.

A damaged or truncated link shows a clear error rather than a broken file.

## Direct transfers (any size)

Files too big for a link go straight from one browser to the other over
WebRTC (`src/core/direct.ts`). It is a session, not a one-off: once two
devices connect, either side can send files and text at any time, as often
as it likes.

- **Connect** (`#/connect`, the 🔗 button in the header;
  `src/ui/connect/ConnectPage.svelte`) has two tabs: **Show my code** (the
  default) shows a QR code for the other device; **Scan a code** reads the
  other device's code with the camera (`QrScanner.svelte`: BarcodeDetector
  where the browser has it, the jsQR decoder elsewhere, or a photo). The old
  `#/direct`, `#/direct/receive` and `#/scan` links open it.
- Several devices can be connected at once, one session each. The header
  button shows a green dot for one, a count for several. Each device has a
  chat (`Chat.svelte`): text and files in order, received files previewed in
  place (`FilePreview.svelte`; PDFs in the full `PdfViewer.svelte`), with
  **Edit** (`EditMenu.svelte`) listing every tool for the file's type,
  whatever section you're in, so a video sent while you're in the PDF tools
  opens in a video tool.
- Arrivals show in a corner notice on every other page
  (`connect/Notice.svelte`), with Edit, Download and Open chat.
- **Share** (`components/ShareMenu.svelte`) is the one share button for
  every result, IT tool output and recording. Hover or tap: connected
  devices first, then **Someone else** (a new QR code; the file goes when it
  connects), then **QR code or link** / **Link** only when the file fits in
  a link, then the system share sheet where there is one.
- Sessions live outside any page (`src/ui/connect/devices.svelte.ts`) and
  survive reloads and switching sections: the invite is kept in
  sessionStorage (this tab only) and both sides reconnect by themselves. Chat
  text is kept with it, files in IndexedDB (`connect/history-db.ts`), and all
  of it is deleted when the session ends.
- A session closes on both devices after **5 minutes without anything sent
  or received**; the chat shows the countdown. A QR code nobody scans expires
  the same way. **End** closes it at once.
- Each device says its name (`deviceName()` in `src/core/device.ts`, such as
  "iPhone · Safari") once per connection.

The QR code holds `<app>#/d/<id>.<secret>.<s|r>`: a random peer ID, a
128-bit secret and which side started with files. A free public matchmaker
(PeerJS's cloud server) passes connection details between the two browsers;
it never sees the files, and never sees the secret, because URL fragments
aren't sent to servers. On networks that block direct connections, PeerJS's
free TURN relay carries the traffic, still encrypted.

If the connection drops (a phone locks its screen, Wi-Fi blips, a page
reloads), the host keeps the same ID and goes back to waiting (a reloaded
host registers it again), and the guest retries for three minutes, so nobody
has to scan again. A batch that was cut off restarts from the beginning after
reconnecting; text messages are re-sent until confirmed. Each session links
one host and one guest.

Security (`src/core/direct-crypto.ts`), checked on every connection:

1. WebRTC's own DTLS encryption protects the connection.
2. Each side sends a fresh random nonce and `HMAC-SHA256(secret, role | own
   DTLS fingerprint | peer fingerprint | nonce)`, and checks the other's. A
   matchmaker that tried to sit in the middle would hold two DTLS sessions
   with different fingerprints, so the check fails and nothing is sent.
   Without the secret it can't forge a tag.
3. Every message is also sealed with AES-256-GCM. Keys come from HKDF over
   the secret and both nonces, so each connection (including a reconnect)
   gets new keys; there is one key per direction and a message counter as
   the GCM nonce, so frames can't be read, altered, replayed or reordered.

Files stream in 64 KB pieces with back-pressure, so memory stays flat on the
sender; the receiver assembles them into a `File` (browsers keep big blobs on
disk). A 12 MB file takes about 3 s between two tabs.

To use your own matchmaker (or test locally with `npx peer --port 9000`),
store PeerJS options in localStorage:
`localStorage['formatter-peer-server'] = '{"host":"localhost","port":9000,"path":"/","secure":false}'`.
