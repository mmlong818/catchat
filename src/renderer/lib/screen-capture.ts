export async function captureScreen(sourceId: string, withAudio = false): Promise<MediaStream> {
  // Modern Electron API: tell main process which source the user picked,
  // then call getDisplayMedia. Main's setDisplayMediaRequestHandler returns the source.
  // This avoids the Electron 30+ "black screen" issue with legacy chromeMediaSource.
  await window.voiceMeet.screen.setActiveSource(sourceId, withAudio);
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { max: 15 },
    },
    audio: withAudio,
  });
  // Set contentHint so the encoder knows this is screen content and starts producing frames.
  // Without this, the track may stay "muted" (no RTP frames) on the receiver side.
  for (const t of stream.getVideoTracks()) {
    t.contentHint = 'detail'; // 'detail' optimizes for text/UI clarity over motion smoothness
  }
  for (const t of stream.getAudioTracks()) {
    t.contentHint = 'music';
  }
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
