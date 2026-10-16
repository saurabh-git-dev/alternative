/**
 * Protect PDF: add a password and optional usage restrictions.
 *
 * Engine: qpdf, AES-256 encryption (the strongest PDF standard, readable by
 * every modern viewer).
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

export const protectPdf: ActionDefinition = {
  id: 'pdf.protect',
  title: 'Protect PDF',
  description: 'Lock a PDF with a password using AES-256 encryption.',
  category: 'pdf-security',
  icon: '🔒',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Protect',
  engines: ['qpdf'],
  params: {
    password: {
      kind: 'text',
      label: 'Password',
      help: 'Needed to open the file. Keep it safe: it cannot be recovered.',
      default: '',
      secret: true,
      validate: (v) => (v.length >= 4 ? null : 'Use at least 4 characters.'),
    },
    confirm: {
      kind: 'text',
      label: 'Repeat password',
      default: '',
      secret: true,
      validate: (v, all) => (v === all.password ? null : 'The passwords don’t match.'),
    },
    allowPrinting: { kind: 'boolean', label: 'Allow printing', default: true, advanced: true },
    allowCopying: { kind: 'boolean', label: 'Allow copying text', default: true, advanced: true },
    allowEditing: { kind: 'boolean', label: 'Allow editing', default: true, advanced: true },
    ownerPassword: {
      kind: 'text',
      label: 'Owner password',
      help: 'Lets you change the restrictions later. Leave empty to generate a random one.',
      default: '',
      secret: true,
      advanced: true,
    },
  },
  async run([file], params) {
    const { runQpdf } = await import('../../engines/qpdf');
    const user = params.password as string;
    const owner = (params.ownerPassword as string) || crypto.randomUUID();
    const [bytes] = await runQpdf({
      inputs: [file.bytes],
      args: [
        '{in0}',
        '--encrypt',
        `--user-password=${user}`,
        `--owner-password=${owner}`,
        '--bits=256',
        `--print=${params.allowPrinting ? 'full' : 'none'}`,
        `--extract=${params.allowCopying ? 'y' : 'n'}`,
        `--modify=${params.allowEditing ? 'all' : 'none'}`,
        '--',
        '{out}',
      ],
    });
    return [{ name: `${baseName(file.name)}-protected.pdf`, type: 'application/pdf', bytes }];
  },
};
