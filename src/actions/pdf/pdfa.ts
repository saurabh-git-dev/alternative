/**
 * PDF to PDF/A: the archival format required by courts, governments and
 * libraries. Every font is embedded, colours get an sRGB output profile, and
 * anything that depends on outside resources is removed, so the file looks
 * the same in decades.
 *
 * Engine: Ghostscript's pdfwrite with -dPDFA. The output intent (sRGB ICC
 * profile from Ghostscript's built-in resources) is attached by a small
 * PDFA_def.ps prelude, as Ghostscript's documentation describes.
 *
 * Caveat: there is no in-browser validator (veraPDF is Java), so the result
 * is "PDF/A as Ghostscript writes it", which passes for the vast majority of
 * documents but isn't formally certified here.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

/** Attaches the sRGB output intent PDF/A requires. */
const PDFA_DEF = `%!
/ICCProfile (%rom%iccprofiles/srgb.icc) def
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} << /N 3 >> /PUT pdfmark
[{icc_PDFA} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} << /Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB) >> /PUT pdfmark
[{Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark
`;

export const pdfToPdfa: ActionDefinition = {
  id: 'pdf.pdfa',
  title: 'PDF to PDF/A',
  description: 'Convert to the archival PDF/A format for long-term storage and official filing.',
  category: 'pdf-convert',
  icon: '🏛️',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Convert to PDF/A',
  engines: ['Ghostscript'],
  params: {
    level: {
      kind: 'enum',
      label: 'Version',
      default: '2',
      options: [
        { value: '2', label: 'PDF/A-2b', hint: 'Recommended: what most courts and archives ask for, keeps transparency and layers' },
        { value: '1', label: 'PDF/A-1b', hint: 'Oldest version, for systems that require it; transparency is flattened' },
        { value: '3', label: 'PDF/A-3b', hint: 'Like 2b, and allows attached files (e.g. e-invoices)' },
      ],
    },
    grayscale: {
      kind: 'boolean',
      label: 'Convert to grayscale',
      help: 'Some archives want black-and-white documents; also makes the file smaller.',
      default: false,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const { runGhostscript } = await import('../../engines/ghostscript');
    ctx.progress(0.1, 'Loading Ghostscript (first time only)');
    const gray = params.grayscale as boolean;
    const bytes = await runGhostscript(
      file.bytes,
      [
        '-sDEVICE=pdfwrite',
        `-dPDFA=${params.level}`,
        // 1 = if something can't be made compliant, drop it (e.g. a JavaScript action) rather than fail.
        '-dPDFACompatibilityPolicy=1',
        `-sColorConversionStrategy=${gray ? 'Gray' : 'RGB'}`,
        '-dNOOUTERSAVE',
      ],
      { files: { '/PDFA_def.ps': gray ? PDFA_DEF.replace('srgb.icc', 'sgray.icc').replace('/N 3', '/N 1').replace('(sRGB)', '(sGray)') : PDFA_DEF }, prelude: ['/PDFA_def.ps'] },
    );
    return [{ name: `${baseName(file.name)}-pdfa.pdf`, type: 'application/pdf', bytes }];
  },
};
