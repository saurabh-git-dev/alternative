/**
 * A still and the length of a video, read with a hidden <video> element.
 * Used for thumbnails in file lists and the recordings library. Resolves to
 * null when the browser can't play the format (e.g. AVI); the tools still
 * work through ffmpeg.wasm.
 */
export interface Poster {
  /** Object URL of a JPEG still; revoke it when done. */
  thumb: string;
  duration: number;
  width: number;
  height: number;
}

export function videoPoster(src: string, width = 320): Promise<Poster | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let duration = 0;
    const done = (value: Poster | null) => {
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 10_000);
    video.onerror = () => done(null);
    video.onloadedmetadata = () => {
      duration = video.duration;
      // Browser recordings report Infinity until the end has been reached once.
      video.currentTime = Number.isFinite(duration) ? Math.min(1, duration / 10) : 1e9;
    };
    video.onseeked = () => {
      if (!Number.isFinite(duration)) {
        duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
        video.currentTime = Math.min(1, duration / 10);
        return;
      }
      const scale = Math.min(1, width / (video.videoWidth || width));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => done(blob ? { thumb: URL.createObjectURL(blob), duration, width: video.videoWidth, height: video.videoHeight } : null),
        'image/jpeg',
        0.8,
      );
    };
    video.src = src;
  });
}
