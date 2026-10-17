/**
 * Certificate-based (digital ID) PDF signing.
 *
 * Source:  node-forge (BSD/GPL) for PKCS#12 and CMS, pdf-lib for the PDF
 *          structure, WebCrypto to generate keys quickly.
 * Output:  a standard `adbe.pkcs7.detached` signature (SHA-256, RSA), which
 *          Acrobat, Foxit, Okular and PDF validators recognise. A certificate
 *          from a trusted authority shows as valid; a self-made ID shows as
 *          "signed, identity not verified" until the reader trusts it.
 *
 * How a PDF signature works: the file is written with a placeholder for the
 * signature (`/Contents <000…>`) and a `/ByteRange` saying which bytes are
 * covered: everything except the placeholder. Those bytes are hashed and
 * signed, and the signature is written into the placeholder without moving
 * any other byte.
 */
import forge from 'node-forge';
import type { PDFDocument as PDFDocumentType, PDFFont, PDFRef } from 'pdf-lib';

export interface Identity {
  key: forge.pki.rsa.PrivateKey;
  certificate: forge.pki.Certificate;
  /** Other certificates in the file (intermediate authorities). */
  chain: forge.pki.Certificate[];
  /** Who the certificate belongs to, for the visible stamp. */
  name: string;
}

/** Open a .p12/.pfx digital ID. */
export function loadIdentity(p12: Uint8Array, password: string): Identity {
  let parsed: forge.pkcs12.Pkcs12Pfx;
  try {
    parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(toBinary(p12)), password);
  } catch (e) {
    throw new Error(/MAC|password|decrypt/i.test(String(e)) ? 'The digital ID password is incorrect.' : "This file isn't a digital ID (.p12 or .pfx) that can be read.");
  }
  const keyBags = [
    ...(parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(parsed.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const key = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  const certs = (parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).flatMap((b) => (b.cert ? [b.cert] : []));
  if (!key) throw new Error('This digital ID has no private key, so it can only verify, not sign.');
  if (!('n' in key)) throw new Error('Only RSA digital IDs are supported for now.');
  // The signing certificate is the one whose public key matches the private key.
  const certificate = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(key.n));
  if (!certificate) throw new Error('This digital ID has no certificate for its key.');
  return { key, certificate, chain: certs.filter((c) => c !== certificate), name: commonName(certificate) };
}

/**
 * Make a new self-signed digital ID (RSA 2048, SHA-256, valid 5 years) and
 * return it with its .p12 file, protected by `password`, to reuse later.
 */
export async function createIdentity(subject: { name: string; email?: string; organization?: string }, password: string): Promise<{ identity: Identity; p12: Uint8Array }> {
  // WebCrypto generates RSA keys in milliseconds; forge's pure-JS prime search takes seconds.
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const key = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(toBinary(pkcs8))) as forge.pki.rsa.PrivateKey;
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  certificate.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16)).replace(/^[89a-f]/, '1');
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000);
  const attrs: forge.pki.CertificateField[] = [{ name: 'commonName', value: subject.name }];
  if (subject.organization) attrs.push({ name: 'organizationName', value: subject.organization });
  if (subject.email) attrs.push({ name: 'emailAddress', value: subject.email });
  certificate.setSubject(attrs);
  certificate.setIssuer(attrs);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', emailProtection: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  certificate.sign(key, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [certificate], password, { algorithm: 'aes256', friendlyName: subject.name });
  return { identity: { key, certificate, chain: [], name: subject.name }, p12: fromBinary(forge.asn1.toDer(p12).getBytes()) };
}

export interface SignOptions {
  reason: string;
  location: string;
  /** Visible stamp, or null for an invisible signature. */
  stamp: { page: 'first' | 'last'; position: string } | null;
}

/** Bytes reserved for the signature: room for a 4096-bit key and a few chain certificates. */
const SIGNATURE_BYTES = 16384;
const BYTE_RANGE_PLACEHOLDER = '**********';

/** Sign a PDF. Returns the signed file and whether it already carried signatures (now invalid). */
export async function signPdf(bytes: Uint8Array, identity: Identity, options: SignOptions): Promise<{ bytes: Uint8Array; hadSignatures: boolean }> {
  const { loadPdf } = await import('./pdflib');
  const lib = await import('pdf-lib');
  const { PDFName, PDFHexString, PDFString, PDFNumber } = lib;
  const doc = await loadPdf(bytes);
  const hadSignatures = doc
    .getForm()
    .getFields()
    .some((f) => f.acroField.dict.get(PDFName.of('FT')) === PDFName.of('Sig') && f.acroField.dict.has(PDFName.of('V')));

  const now = new Date();
  const signature = doc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, PDFName.of(BYTE_RANGE_PLACEHOLDER), PDFName.of(BYTE_RANGE_PLACEHOLDER), PDFName.of(BYTE_RANGE_PLACEHOLDER)],
    Contents: PDFHexString.of('0'.repeat(SIGNATURE_BYTES * 2)),
    Name: PDFString.of(identity.name),
    M: PDFString.fromDate(now),
    ...(options.reason ? { Reason: PDFString.of(options.reason) } : {}),
    ...(options.location ? { Location: PDFString.of(options.location) } : {}),
  });
  const signatureRef = doc.context.register(signature);

  const pages = doc.getPages();
  const page = options.stamp?.page === 'first' ? pages[0] : pages[pages.length - 1];
  const rect = options.stamp ? stampRect(page.getCropBox(), options.stamp.position) : [0, 0, 0, 0];
  const fieldName = `Signature${Date.now()}`;
  const widget = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: rect,
    V: signatureRef,
    T: PDFString.of(fieldName),
    F: 4, // print
    P: page.ref,
  });
  if (options.stamp) {
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    const bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
    widget.set(PDFName.of('AP'), doc.context.obj({ N: stampAppearance(doc, lib, font, bold, rect, identity.name, options, now) }));
  }
  const widgetRef = doc.context.register(widget);
  page.node.addAnnot(widgetRef);

  // AcroForm with SigFlags 3: "signatures exist" + "append only", so viewers warn before rewriting the file.
  const catalog = doc.catalog;
  let acroForm = catalog.lookupMaybe(PDFName.of('AcroForm'), lib.PDFDict);
  if (!acroForm) {
    acroForm = doc.context.obj({ Fields: [] });
    catalog.set(PDFName.of('AcroForm'), doc.context.register(acroForm));
  }
  const fields = acroForm.lookupMaybe(PDFName.of('Fields'), lib.PDFArray) ?? doc.context.obj([]);
  fields.push(widgetRef);
  acroForm.set(PDFName.of('Fields'), fields);
  acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  // No object streams: the placeholders must appear as plain text in the file.
  const prepared = await doc.save({ useObjectStreams: false });
  return { bytes: embedSignature(prepared, identity), hadSignatures };
}

/** Fill in /ByteRange and /Contents of the prepared file. */
function embedSignature(pdf: Uint8Array, identity: Identity): Uint8Array {
  const text = toBinary(pdf);
  const rangeStart = text.lastIndexOf(`/ByteRange [ 0 /${BYTE_RANGE_PLACEHOLDER}`);
  if (rangeStart < 0) throw new Error('Could not prepare the signature (no byte range).');
  const rangeEnd = text.indexOf(']', rangeStart) + 1;
  // pdf-lib writes the keys in insertion order, so /Contents follows /ByteRange.
  const contentsStart = text.indexOf('/Contents <', rangeStart) + '/Contents '.length;
  const contentsEnd = text.indexOf('>', contentsStart) + 1;
  const range = [0, contentsStart, contentsEnd, pdf.length - contentsEnd];
  const rangeText = `/ByteRange [ ${range.join(' ')} ]`;
  const placeholder = text.slice(rangeStart, rangeEnd);
  if (rangeText.length > placeholder.length) throw new Error('Could not prepare the signature (byte range too long).');

  const out = pdf.slice();
  out.set(fromBinary(rangeText.padEnd(placeholder.length, ' ')), rangeStart);

  // Sign everything except the <…> placeholder.
  const signed = toBinary(out.subarray(0, contentsStart)) + toBinary(out.subarray(contentsEnd));
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(signed);
  p7.addCertificate(identity.certificate);
  for (const c of identity.chain) p7.addCertificate(c);
  p7.addSigner({
    key: identity.key,
    certificate: identity.certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const hex = forge.util.bytesToHex(der).toUpperCase();
  if (hex.length > SIGNATURE_BYTES * 2) throw new Error('The signature is too large for the space reserved in the PDF.');
  out.set(fromBinary(`<${hex.padEnd(SIGNATURE_BYTES * 2, '0')}>`), contentsStart);
  return out;
}

const STAMP_W = 220;
const STAMP_H = 62;

/** Stamp rectangle on the page for a 3×3 position like "bottom-right". */
function stampRect(box: { x: number; y: number; width: number; height: number }, position: string): number[] {
  const margin = 36;
  const [v, h] = position.split('-');
  const x = h === 'left' ? box.x + margin : h === 'center' ? box.x + (box.width - STAMP_W) / 2 : box.x + box.width - margin - STAMP_W;
  const y = v === 'top' ? box.y + box.height - margin - STAMP_H : v === 'middle' ? box.y + (box.height - STAMP_H) / 2 : box.y + margin;
  return [x, y, x + STAMP_W, y + STAMP_H];
}

function stampAppearance(
  doc: PDFDocumentType,
  lib: typeof import('pdf-lib'),
  font: PDFFont,
  bold: PDFFont,
  rect: number[],
  name: string,
  options: SignOptions,
  date: Date,
): PDFRef {
  const w = rect[2] - rect[0];
  const h = rect[3] - rect[1];
  const lines = [
    `Date: ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    ...(options.reason ? [`Reason: ${options.reason}`] : []),
    ...(options.location ? [`Location: ${options.location}`] : []),
  ];
  const { rgb, pushGraphicsState, popGraphicsState, setFillingColor, setStrokingColor, rectangle, fill, stroke, setLineWidth, beginText, endText, setFontAndSize, moveText, showText } = lib;
  const ops = [
    pushGraphicsState(),
    setFillingColor(rgb(0.95, 0.96, 1)),
    rectangle(0, 0, w, h),
    fill(),
    setStrokingColor(rgb(0.31, 0.27, 0.9)),
    setLineWidth(1),
    rectangle(0.5, 0.5, w - 1, h - 1),
    stroke(),
    beginText(),
    setFillingColor(rgb(0.31, 0.27, 0.9)),
    setFontAndSize('F2', 9),
    moveText(8, h - 15),
    showText(bold.encodeText(fit(bold, `Digitally signed by ${encodable(bold, name)}`, 9, w - 16))),
    setFillingColor(rgb(0.15, 0.16, 0.22)),
    setFontAndSize('F1', 8),
    ...lines.flatMap((line) => [moveText(0, -11.5), showText(font.encodeText(fit(font, encodable(font, line), 8, w - 16)))]),
    endText(),
    popGraphicsState(),
  ];
  const stream = doc.context.formXObject(ops, {
    BBox: [0, 0, w, h],
    Resources: { Font: { F1: font.ref, F2: bold.ref } },
  });
  return doc.context.register(stream);
}

/** Replace characters the standard fonts can't draw (they only cover Latin). */
function encodable(font: PDFFont, text: string): string {
  return [...text]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return '?';
      }
    })
    .join('');
}

/** Shorten text with an ellipsis to fit `width` points. */
function fit(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t}…`;
}

function commonName(cert: forge.pki.Certificate): string {
  return (cert.subject.getField('CN')?.value as string | undefined) ?? (cert.subject.getField('O')?.value as string | undefined) ?? 'Unknown signer';
}

function toBinary(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

function fromBinary(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
