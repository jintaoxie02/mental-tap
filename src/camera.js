/**
 * Camera access and frame capture for fingertip PPG.
 * Requests rear camera with flash, captures frames at 30fps.
 */

export async function getCamera() {
  // Try rear camera first, fall back to any camera
  const constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    // Fallback: any camera
    stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
  }

  const track = stream.getVideoTracks()[0];

  // Try to enable torch/flashlight
  try {
    await track.applyConstraints({
      advanced: [{ torch: true }],
    });
  } catch {
    // torch not supported (iOS Safari) — user must be in bright environment
    console.warn('Torch not available. Using ambient light.');
  }

  return { stream, track };
}

/**
 * Start capturing frames from the video stream.
 * Calls `onFrame` with the green-channel average at each animation frame.
 * Returns a stop function.
 */
export function startCapture(track, onFrame) {
  const capabilities = track.getCapabilities?.() || {};
  const maxWidth = capabilities.width?.max || 640;
  const maxHeight = capabilities.height?.max || 480;

  // Create offscreen elements for frame processing
  const video = document.createElement('video');
  video.srcObject = new MediaStream([track]);
  video.playsInline = true;
  video.muted = true;
  video.setAttribute('playsinline', '');
  video.play().catch(console.error);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Use a small capture resolution for performance
  const capW = Math.min(maxWidth, 320);
  const capH = Math.min(maxHeight, 240);
  canvas.width = capW;
  canvas.height = capH;

  // ROI: center of frame (where fingertip is)
  const roiX = Math.floor(capW * 0.2);
  const roiY = Math.floor(capH * 0.2);
  const roiW = Math.floor(capW * 0.6);
  const roiH = Math.floor(capH * 0.6);

  let animId;
  let lastTime = 0;
  const targetInterval = 1000 / 30; // 30fps target

  function processFrame(timestamp) {
    animId = requestAnimationFrame(processFrame);

    // Throttle to ~30fps
    if (timestamp - lastTime < targetInterval - 2) return;
    lastTime = timestamp;

    if (video.readyState < 2) return;

    try {
      ctx.drawImage(video, 0, 0, capW, capH);
      const imageData = ctx.getImageData(roiX, roiY, roiW, roiH);
      const pixels = imageData.data;

      // Average the GREEN channel only (most sensitive to blood volume changes)
      let greenSum = 0;
      const n = roiW * roiH;
      for (let i = 1; i < pixels.length; i += 4) {
        greenSum += pixels[i];
      }
      const greenAvg = greenSum / n;

      onFrame(greenAvg, timestamp);
    } catch {
      // Frame capture can fail if video not ready — skip frame
    }
  }

  animId = requestAnimationFrame(processFrame);

  return () => {
    cancelAnimationFrame(animId);
    video.pause();
    video.srcObject = null;
  };
}

export function stopCamera(stream) {
  stream.getTracks().forEach(t => t.stop());
}
