import { describe, expect, it } from 'vitest';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { createIdentity, loadIdentity, signPdf } from '../src/engines/signing';

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

/** Independent check: byte range covers all but the signature, digest matches, RSA signature verifies. */
function verify(pdf: Uint8Array) {
  const text = latin1(pdf);
  const [, a, b, c, d] = [...text.matchAll(/\/ByteRange \[ (\d+) (\d+) (\d+) (\d+)/g)].at(-1)!.map(Number);
  expect(a).toBe(0);
  expect(c + d).toBe(pdf.length);
  expect(text[b]).toBe('<');
  expect(text[c - 1]).toBe('>');
  const der = forge.util.hexToBytes(text.slice(b + 1, c - 1));
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der, { parseAllBytes: false } as unknown as boolean)) as forge.pkcs7.PkcsSignedData & { rawCapture: { authenticatedAttributes: forge.asn1.Asn1[]; signature: string } };
  const signed = text.slice(0, b) + text.slice(c);
  const digest = forge.md.sha256.create().update(signed).digest().getBytes();
  const attrs = p7.rawCapture.authenticatedAttributes;
  const mdAttr = attrs.find((x) => forge.asn1.derToOid((x.value as forge.asn1.Asn1[])[0].value as string) === forge.pki.oids.messageDigest)!;
  expect(((mdAttr.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0].value).toBe(digest);
  const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
  const attrDigest = forge.md.sha256.create().update(forge.asn1.toDer(set).getBytes());
  const cert = p7.certificates[0];
  expect((cert.publicKey as forge.pki.rsa.PublicKey).verify(attrDigest.digest().getBytes(), p7.rawCapture.signature)).toBe(true);
  return cert;
}

describe('digital signatures', () => {
  it('creates an ID, reopens it from its .p12, and signs verifiably', async () => {
    const { p12 } = await createIdentity({ name: 'Ada Lovelace', email: 'ada@example.com' }, 'pass1234');
    const identity = loadIdentity(p12, 'pass1234');
    expect(identity.name).toBe('Ada Lovelace');
    expect(() => loadIdentity(p12, 'nope')).toThrow(/password is incorrect/);

    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    const { bytes, hadSignatures } = await signPdf(await doc.save(), identity, {
      reason: 'I approve',
      location: 'Pune',
      stamp: { page: 'last', position: 'bottom-right' },
    });
    expect(hadSignatures).toBe(false);
    const cert = verify(bytes);
    expect(cert.subject.getField('CN').value).toBe('Ada Lovelace');
    // Still a valid PDF with a signature field on the last page.
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getForm().getFields().map((f) => f.constructor.name)).toEqual(['PDFSignature']);
    expect(latin1(bytes)).toContain('/Reason (I approve)');
  });

  it('reports that an already-signed PDF had signatures', async () => {
    const { identity } = await createIdentity({ name: 'Signer' }, 'pass1234');
    const doc = await PDFDocument.create();
    doc.addPage();
    const once = await signPdf(await doc.save(), identity, { reason: '', location: '', stamp: null });
    const twice = await signPdf(once.bytes, identity, { reason: '', location: '', stamp: null });
    expect(twice.hadSignatures).toBe(true);
    verify(twice.bytes);
  });
});
