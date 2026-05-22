export async function captureScreen(sourceId: string, withAudio = false): Promise<MediaStream> {
  // Electron-specific getUserMedia constraints for desktopCapturer source
  const constraints: any = {
    audio: withAudio
      ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 15,
      },
    },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  return stream;
}

/** Take a single frame from the PRIMARY screen, return as { dataUrl, width, height } */
export async function grabPrimaryScreen(): Promise<{ dataUrl: string; width: number; height: number }> {
  const sources = await window.voiceMeet.screen.getSources();
  const screen = sources.find((s) => s.isScreen) || sources[0];
  if (!screen) throw new Error('找不到可用屏幕');
  const stream = await captureScreen(screen.id);
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise<void>((r) => {
      if (video.readyState >= 2) r();
      else video.addEventListener('loadeddata', () => r(), { once: true });
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** Take a single frame from a desktop source, return as image File */
export async function takeScreenshot(sourceId: string, name = 'screenshot.png'): Promise<File> {
  const stream = await captureScreen(sourceId);
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Wait for first frame
    await new Promise<void>((r) => {
      if (video.readyState >= 2) r();
      else video.addEventListener('loadeddata', () => r(), { once: true });
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'),
    );
    return new File([blob], name, { type: 'image/png' });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
