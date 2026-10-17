/**
 * Trim video: keep the part between two points picked on the timeline.
 *
 * "Exact" re-encodes so the cut lands on the chosen frame. "Fast" copies the
 * encoded video untouched (no quality loss, near instant), so the start
 * snaps to the key frame just before it, usually within a second or two.
 */
import type { ActionDefinition } from '../../core/types';
import type { TimeRange } from '../../core/video';
import { VIDEO_ACCEPTS, VIDEO_DEMANDING, VIDEO_ENGINES, audioParam, containerOf, formatParam, runJob } from './shared';

export const trimVideo: ActionDefinition = {
  id: 'video.trim',
  title: 'Trim video',
  description: 'Cut the start and end off a video, frame-accurately or instantly.',
  category: 'video-edit',
  icon: '✂️',
  accepts: VIDEO_ACCEPTS,
  mode: 'each',
  maxFiles: 1,
  verb: 'Trim',
  engines: VIDEO_ENGINES,
  demanding: VIDEO_DEMANDING,
  params: {
    range: { kind: 'timeRange', label: 'Part to keep', default: { start: 0, end: 0 } },
    mode: {
      kind: 'enum',
      label: 'Cut',
      default: 'exact',
      options: [
        { value: 'exact', label: 'Exact', hint: 'Cuts on the exact frame; re-encodes, so it takes a while' },
        { value: 'fast', label: 'Fast', hint: 'Instant and lossless; the start may move back to the nearest key frame' },
      ],
      display: 'segmented',
    },
    audio: audioParam,
    format: formatParam,
  },
  async run([file], params, ctx) {
    const range = params.range as TimeRange;
    return [
      await runJob(
        file,
        { container: containerOf(params.format, file), trim: range, copy: params.mode === 'fast', quality: params.mode === 'fast' ? undefined : 'very-high', audio: params.audio as 'keep' | 'remove' },
        ctx,
        '-trimmed',
      ),
    ];
  },
};
