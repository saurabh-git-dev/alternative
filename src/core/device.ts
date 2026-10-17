/**
 * What the current device can comfortably do. Used to warn before tools that
 * download large engines or need a lot of memory, and to keep their limits
 * safe on phones. Works in the page and in workers.
 *
 * Browsers expose only rough hints: `navigator.deviceMemory` (Chromium only,
 * capped at 8 and rounded), User-Agent Client Hints, and touch support. So the
 * result is a best guess, and warnings never block a tool.
 */

export interface DeviceInfo {
  /** A phone or tablet (iPads report as Macs, so touch is checked too). */
  mobile: boolean;
  /** Approximate RAM in GB, when the browser tells us. */
  memoryGB?: number;
  /** WebGPU is available, so AI tools can use the graphics chip. */
  webgpu: boolean;
}

type Nav = Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean }; gpu?: unknown };

export function deviceInfo(): DeviceInfo {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as Nav;
  const ua = nav.userAgent ?? '';
  const mobile =
    nav.userAgentData?.mobile ?? (/Android|iPhone|iPad|iPod|Mobi/i.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1));
  return { mobile, memoryGB: nav.deviceMemory, webgpu: 'gpu' in nav };
}

/** True when heavy tools may be slow or run out of memory: phones, tablets and low-RAM computers. */
export function isConstrained(info = deviceInfo()): boolean {
  return info.mobile || (info.memoryGB !== undefined && info.memoryGB <= 4);
}

/**
 * Largest image, in pixels, that memory-hungry image tools should produce.
 * Mobile browsers kill tabs well before desktop ones (iOS Safari at around
 * 1–1.5 GB), so phones get a much lower ceiling.
 */
export function pixelBudget(desktop: number, info = deviceInfo()): number {
  if (!isConstrained(info)) return desktop;
  return Math.min(desktop, info.memoryGB !== undefined && info.memoryGB >= 6 ? 32_000_000 : 16_000_000);
}
