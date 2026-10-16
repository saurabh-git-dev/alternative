/**
 * Compress PDF: make a PDF smaller while keeping it readable.
 *
 * Engines: Ghostscript (re-distils the PDF: downsamples and re-encodes images,
 * subsets fonts, drops duplicates), then qpdf (lossless object-stream and
 * Flate recompression for a few extra percent).
 *
 * Quality guard: if the result is not smaller than the original, the original
 * is returned unchanged with a note, so compressing can never make things worse.
 */
import type { ActionDefinition } from '../../core/types';
import { baseName } from '../../core/files';

/** Image resolution (dpi) per level. Ghostscript's PDFSETTINGS choose the rest. */
const LEVELS = {
  light: { settings: '/printer', dpi: 300 },
  recommended: { settings: '/ebook', dpi: 150 },
  strong: { settings: '/screen', dpi: 96 },
  extreme: { settings: '/screen', dpi: 72 },
} as const;

export const compressPdf: ActionDefinition = {
  id: 'pdf.compress',
  title: 'Compress PDF',
  description: 'Reduce file size while keeping the best possible quality.',
  category: 'pdf-optimize',
  icon: '🗜️',
  accepts: ['application/pdf'],
  mode: 'each',
  verb: 'Compress',
  engines: ['ghostscript', 'qpdf'],
  defaultPreset: 'recommended',
  presets: [
    { id: 'light', label: 'Light', description: 'Print quality, smaller savings (300 dpi images)', values: { level: 'light' } },
    { id: 'recommended', label: 'Recommended', description: 'Great on screen, big savings (150 dpi images)', values: { level: 'recommended' } },
    { id: 'extreme', label: 'Extreme', description: 'Smallest file, lower image quality (72 dpi)', values: { level: 'extreme' } },
  ],
  params: {
    level: {
      kind: 'enum',
      label: 'Compression level',
      default: 'recommended',
      display: 'select',
      advanced: true,
      options: [
        { value: 'light', label: 'Light (300 dpi)' },
        { value: 'recommended', label: 'Recommended (150 dpi)' },
        { value: 'strong', label: 'Strong (96 dpi)' },
        { value: 'extreme', label: 'Extreme (72 dpi)' },
      ],
    },
    imageDpi: {
      kind: 'number',
      label: 'Custom image resolution',
      help: 'Override the level’s image resolution. 0 keeps the level’s value.',
      default: 0,
      min: 0,
      max: 600,
      step: 1,
      unit: 'dpi',
      display: 'input',
      advanced: true,
    },
    grayscale: {
      kind: 'boolean',
      label: 'Convert to black & white',
      help: 'Removes colour. Useful for scanned text documents.',
      default: false,
      advanced: true,
    },
    stripMetadata: {
      kind: 'boolean',
      label: 'Remove hidden metadata',
      help: 'Drops author, software and XMP information.',
      default: false,
      advanced: true,
    },
    losslessPass: {
      kind: 'boolean',
      label: 'Extra lossless squeeze',
      help: 'Re-pack the file structure with qpdf after compressing. Never affects quality.',
      default: true,
      advanced: true,
    },
  },
  async run([file], params, ctx) {
    const [{ runGhostscript }, { runQpdf }] = await Promise.all([
      import('../../engines/ghostscript'),
      import('../../engines/qpdf'),
    ]);
    const level = LEVELS[params.level as keyof typeof LEVELS] ?? LEVELS.recommended;
    const dpi = (params.imageDpi as number) || level.dpi;

    const args = [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.6',
      `-dPDFSETTINGS=${level.settings}`,
      '-dDetectDuplicateImages=true',
      '-dCompressFonts=true',
      '-dSubsetFonts=true',
      '-dAutoRotatePages=/None',
      // Only downsample images noticeably above the target (1.5× threshold),
      // which avoids degrading images that are already about the right size.
      ...['Color', 'Gray', 'Mono'].flatMap((kind) => [
        `-d${kind}ImageResolution=${kind === 'Mono' ? Math.max(dpi * 2, 300) : dpi}`,
        `-dDownsample${kind}Images=true`,
        `-d${kind}ImageDownsampleThreshold=1.5`,
        `-d${kind}ImageDownsampleType=/${kind === 'Mono' ? 'Subsample' : 'Bicubic'}`,
      ]),
    ];
    if (params.grayscale) {
      args.push('-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray');
    }

    ctx.progress(0.1, 'Loading compression engine');
    let bytes = await runGhostscript(file.bytes, args);
    ctx.progress(0.8, 'Optimising structure');

    if (params.losslessPass || params.stripMetadata) {
      const qpdfArgs = ['{in0}'];
      if (params.losslessPass) {
        qpdfArgs.push('--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9');
      }
      if (params.stripMetadata) qpdfArgs.push('--remove-metadata', '--remove-info');
      qpdfArgs.push('{out}');
      [bytes] = await runQpdf({ inputs: [bytes], args: qpdfArgs });
    }

    const name = `${baseName(file.name)}-compressed.pdf`;
    if (bytes.length >= file.bytes.length && !params.grayscale) {
      return [{ name, type: 'application/pdf', bytes: file.bytes, note: 'Already well optimised, so the original was kept.' }];
    }
    return [{ name, type: 'application/pdf', bytes }];
  },
};
