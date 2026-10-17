/**
 * The floating camera bubble for "Screen + camera" recordings: the camera in
 * a small always-on-top window, so it shows on top of whatever you're
 * recording. Uses a round Document Picture-in-Picture window where the
 * browser has one (Chrome, Edge), and the classic video Picture-in-Picture
 * otherwise (Safari, Firefox: a rectangle).
 *
 * Both need a click to open, so the recorder offers a button when opening
 * it automatically isn't allowed.
 */
type DocPip = { requestWindow(options: { width: number; height: number; disallowReturnToOpener?: boolean }): Promise<Window> };

export async function openBubble(stream: MediaStream, size = 220): Promise<() => void> {
  const docPip = (window as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture;
  if (docPip) {
    const win = await docPip.requestWindow({ width: size, height: size, disallowReturnToOpener: true });
    const style = win.document.createElement('style');
    style.textContent = `
      html, body { margin: 0; height: 100%; background: #111; overflow: hidden; }
      video { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; transform: scaleX(-1); display: block; }
    `;
    const video = win.document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;
    win.document.head.append(style);
    win.document.body.append(video);
    return () => win.close();
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  await video.requestPictureInPicture();
  return () => {
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture();
    video.srcObject = null;
  };
}
