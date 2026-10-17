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
WebRTC (`src/core/direct.ts`, page `src/ui/pages/Direct.svelte`):

- **Send to your phone** (`#/direct`): pick files, show a QR code; the device
  that scans it receives them.
- **Get files from your phone** (`#/direct/receive`): show a QR code; the
  device that scans it picks files and sends them back.

The QR code holds `<app>#/d/<id>.<secret>.<s|r>`: a random single-use peer
ID, a 128-bit secret and the direction. A free public matchmaker (PeerJS's
cloud server) passes connection details between the two browsers; it never
sees the files, and never sees the secret, because URL fragments aren't sent
to servers. On networks that block direct connections, PeerJS's free TURN
relay carries the traffic, still encrypted.

Security (`src/core/direct-crypto.ts`):

1. WebRTC's own DTLS encryption protects the connection.
2. Both sides send `HMAC-SHA256(secret, role | own DTLS fingerprint | peer
   fingerprint)` and check the other's. A matchmaker that tried to sit in the
   middle would hold two DTLS sessions with different fingerprints, so the
   check fails and nothing is sent. Without the secret it can't forge a tag.
3. Every message is also sealed with AES-256-GCM, one HKDF-derived key per
   direction and a message counter as the nonce, so frames can't be read,
   altered, replayed or reordered.

Files stream in 64 KB pieces with back-pressure, so memory stays flat on the
sender; the receiver assembles them into a `File` (browsers keep big blobs on
disk). A 12 MB file takes about 3 s between two tabs.

To use your own matchmaker (or test locally with `npx peer --port 9000`),
store PeerJS options in localStorage:
`localStorage['formatter-peer-server'] = '{"host":"localhost","port":9000,"path":"/","secure":false}'`.
