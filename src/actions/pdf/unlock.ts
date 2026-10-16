/**
 * Unlock PDF: remove the password and restrictions from a PDF you can open.
 *
 * Engine: qpdf. Requires the correct password; this tool does not crack passwords.
 * Files that only have restrictions (no open password) unlock with the field empty.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

export const unlockPdf: ActionDefinition = {
  id: 'pdf.unlock',
  title: 'Unlock PDF',
  description: 'Remove the password from a PDF you have the password for.',
  category: 'pdf-security',
  icon: '🔓',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Unlock',
  engines: ['qpdf'],
  params: {
    password: {
      kind: 'text',
      label: 'Current password',
      help: 'Leave empty if the file opens without one but has printing or copying restrictions.',
      default: '',
      secret: true,
    },
  },
  async run([file], params) {
    const { runQpdf } = await import('../../engines/qpdf');
    const [bytes] = await runQpdf({
      inputs: [file.bytes],
      args: [`--password=${params.password as string}`, '--decrypt', '{in0}', '{out}'],
    });
    return [{ name: `${baseName(file.name)}-unlocked.pdf`, type: 'application/pdf', bytes }];
  },
};
