/**
 * Camera access and frame capture for fingertip PPG.
 * Requests rear camera with flash, captures frames at ~30fps.
 * Adds video to DOM — required for reliable autoplay on mobile.
 */

export async function getCamera() {
  const constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 640 },
      height: { ideal: 480 },
      // Prefer 60 fps — beat-timing quantization (and therefore RMSSD noise)
      // roughly halves vs 30 fps. Devices that can't deliver 60 fps fall back
      // automatically; the analysis adapts via estimateFs().
      frameRate: { ideal: 60 },
    },
    audio: false,
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }

  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('No video track available');

  // Enable torch on supported browsers (Chrome Android)
  try {
    await track.applyConstraints({ advanced: [{ torch: true }] });
  } catch {
    // iOS Safari: torch not supported, fall back to ambient light
  }

  return { stream, track };
}

/**
 * Start capturing frames from the video stream.
 * Returns a stop function. The video element is added to the DOM
 * because offscreen videos fail to play reliably on mobile.
 */
export function startCapture(track, onFrame) {
  // Create and DOM-attach video element (critical for mobile autoplay)
  const container = document.getElementById('video-container');
  const video = document.createElement('video');
  video.id = 'capture-video';
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
  container.appendChild(video);

  video.srcObject = new MediaStream([track]);

  // Await play — failures here mean no frames
  const playPromise = video.play();
  let videoReady = false;
  playPromise.then(() => { videoReady = true; }).catch(err => {
    console.error('Video play failed:', err);
  });

  // Offscreen canvas for frame extraction. We downscale the center 60% of the
  // stream directly into a 64×64 canvas — 4,096 pixels instead of a 192×144
  // ROI readback (27,648 px). The browser's bilinear downscale acts as the
  // spatial anti-aliasing average, so the averaged green value is unchanged.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const capSize = 64;
  canvas.width = capSize;
  canvas.height = capSize;

  let animId;
  let lastTime = 0;
  const targetInterval = 16; // ~60fps target (adapts to delivered rate)
  let frameCount = 0;

  // Prefer requestVideoFrameCallback: it fires once per *presented video frame*
  // with a media-clock timestamp, removing display-to-media jitter from the IBI
  // timing. Fall back to requestAnimationFrame if rVFC is unavailable or never
  // fires (some iOS builds).
  let rvfcActive = false;
  let rvfcFallbackTimer = null;

  function processFrame(timestamp, mediaTimeMs) {
    const ts = mediaTimeMs !== undefined ? mediaTimeMs : timestamp;

    // Re-arm the driver
    if (rvfcActive) {
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(step);
      }
    } else {
      animId = requestAnimationFrame(processFrame);
    }

    if (ts - lastTime < targetInterval) return;
    lastTime = ts;

    // Wait for video to actually be playing
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    try {
      // Center 60% of the stream, downscaled to the 64×64 capture canvas
      const vw = video.videoWidth || capSize;
      const vh = video.videoHeight || capSize;
      const srcX = vw * 0.2, srcY = vh * 0.2;
      const srcW = vw * 0.6, srcH = vh * 0.6;
      ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, capSize, capSize);
      const imageData = ctx.getImageData(0, 0, capSize, capSize);
      const pixels = imageData.data;

      let greenSum = 0;
      const n = capSize * capSize;
      for (let i = 1; i < pixels.length; i += 4) {
        greenSum += pixels[i];
      }
      const greenAvg = greenSum / n;
      frameCount++;
      onFrame(greenAvg, ts);
    } catch {
      // Skip frame on error
    }
  }

  function step(now, meta) {
    rvfcActive = true;
    if (rvfcFallbackTimer) { clearTimeout(rvfcFallbackTimer); rvfcFallbackTimer = null; }
    cancelAnimationFrame(animId); // stop any rAF loop that started first
    processFrame(now, meta.mediaTime * 1000);
  }

  if (typeof video.requestVideoFrameCallback === 'function') {
    try {
      video.requestVideoFrameCallback(step);
      // If rVFC never fires (unsupported iOS path), fall back to rAF
      rvfcFallbackTimer = setTimeout(() => {
        if (!rvfcActive) animId = requestAnimationFrame(processFrame);
      }, 500);
    } catch {
      animId = requestAnimationFrame(processFrame);
    }
  } else {
    animId = requestAnimationFrame(processFrame);
  }

  return () => {
    cancelAnimationFrame(animId);
    if (rvfcFallbackTimer) clearTimeout(rvfcFallbackTimer);
    video.pause();
    video.srcObject = null;
    if (video.parentNode) video.parentNode.removeChild(video);
  };
}

export function stopCamera(stream) {
  stream.getTracks().forEach(t => t.stop());
}
