/**
 * Digitally sign PDF: a certificate-based signature, the kind PDF readers
 * check and show as "Signed by …". Unlike Sign PDF (a drawn signature
 * image), it proves who signed and that the file hasn't changed since.
 *
 * Uses your digital ID (.p12 / .pfx, e.g. from your employer, a government
 * e-ID or a certificate authority), or makes a new self-signed one, which is
 * offered as a download so later documents can be signed with the same ID.
 * See src/engines/signing.ts.
 */
import type { ActionDefinition, FileValue, OutputFile } from '../../core/types';
import { baseName } from '../../core/files';

export const digitalSignPdf: ActionDefinition = {
  id: 'pdf.digital-sign',
  title: 'Digitally sign PDF',
  description: 'Sign with a digital ID (certificate) so readers can verify who signed and that nothing changed.',
  category: 'pdf-security',
  icon: '🔏',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Sign digitally',
  engines: ['node-forge', 'pdf-lib'],
  params: {
    source: {
      kind: 'enum',
      label: 'Digital ID',
      default: 'file',
      options: [
        { value: 'file', label: 'Use my digital ID', hint: 'A .p12 or .pfx file, from your organisation, an e-ID or a certificate authority' },
        { value: 'new', label: 'Create a new one', hint: 'A self-made ID: proves the file is unchanged, but readers see your identity as unverified' },
      ],
    },
    idFile: {
      kind: 'file',
      label: 'Digital ID file',
      accept: '.p12,.pfx,application/x-pkcs12',
      placeholder: 'Choose .p12 / .pfx…',
      default: null,
      required: true,
      visibleWhen: (v) => v.source === 'file',
    },
    name: {
      kind: 'text',
      label: 'Your name',
      default: '',
      placeholder: 'As it should appear on the signature',
      validate: (value) => (value.trim() ? null : 'Enter your name.'),
      visibleWhen: (v) => v.source === 'new',
    },
    email: {
      kind: 'text',
      label: 'Email (optional)',
      default: '',
      visibleWhen: (v) => v.source === 'new',
    },
    password: {
      kind: 'text',
      label: 'Digital ID password',
      help: 'For a new ID, this protects the ID file you download with the signed PDF.',
      default: '',
      secret: true,
      validate: (value, v) => (v.source === 'new' && value.length < 4 ? 'Use at least 4 characters.' : null),
    },
    reason: {
      kind: 'text',
      label: 'Reason',
      default: 'I approve this document',
    },
    location: {
      kind: 'text',
      label: 'Location (optional)',
      default: '',
      advanced: true,
    },
    visible: {
      kind: 'boolean',
      label: 'Show a signature stamp on the page',
      help: 'Off: the signature is only visible in the reader’s signature panel.',
      default: true,
    },
    page: {
      kind: 'enum',
      label: 'Stamp on',
      default: 'last',
      options: [
        { value: 'last', label: 'Last page' },
        { value: 'first', label: 'First page' },
      ],
      advanced: true,
      visibleWhen: (v) => v.visible === true,
    },
    position: {
      kind: 'position',
      label: 'Stamp position',
      default: 'bottom-right',
      advanced: true,
      visibleWhen: (v) => v.visible === true,
    },
  },
  async run([file], params, ctx) {
    const { createIdentity, loadIdentity, signPdf } = await import('../../engines/signing');
    const outputs: OutputFile[] = [];
    let identity;
    if (params.source === 'new') {
      ctx.progress(0.1, 'Creating your digital ID');
      const made = await createIdentity({ name: (params.name as string).trim(), email: (params.email as string).trim() || undefined }, params.password as string);
      identity = made.identity;
      outputs.push({
        name: `${(params.name as string).trim().replace(/[^\p{L}\p{N}]+/gu, '-')}-digital-id.p12`,
        type: 'application/x-pkcs12',
        bytes: made.p12,
        note: 'Your new digital ID. Keep it (and its password) to sign future documents as the same person.',
      });
    } else {
      const id = params.idFile as FileValue | null;
      if (!id) throw new Error('Choose your digital ID file first.');
      identity = loadIdentity(id.bytes, params.password as string);
    }
    const now = new Date();
    if (identity.certificate.validity.notAfter < now) throw new Error('This digital ID has expired, so signatures made with it would show as invalid.');
    ctx.progress(0.5, 'Signing');
    const { bytes, hadSignatures } = await signPdf(file.bytes, identity, {
      reason: (params.reason as string).trim(),
      location: (params.location as string).trim(),
      stamp: params.visible ? { page: params.page as 'first' | 'last', position: params.position as string } : null,
    });
    outputs.unshift({
      name: `${baseName(file.name)}-signed.pdf`,
      type: 'application/pdf',
      bytes,
      note: hadSignatures ? 'This PDF already had a signature. Adding yours rewrote the file, so the earlier signature now shows as invalid.' : undefined,
    });
    return outputs;
  },
};
