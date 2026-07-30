/**
 * Live scrolling PPG waveform display on Canvas.
 * Renders a dark monitor-style trace with glow effect.
 */

export class WaveformDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = new Float64Array(0);
    this.maxPoints = 600; // 20 seconds at 30fps
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
    this.draw();
  }

  /**
   * Push new PPG sample and redraw.
   */
  push(value) {
    const arr = [...this.data, value];
    if (arr.length > this.maxPoints) {
      // Keep most recent points
      arr.splice(0, arr.length - this.maxPoints);
    }
    this.data = new Float64Array(arr);
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Dark background
    ctx.fillStyle = '#131316';
    ctx.fillRect(0, 0, w, h);

    if (this.data.length < 2) {
      // Draw guide lines
      ctx.strokeStyle = '#2A2A2F';
      ctx.lineWidth = 1;
      for (let y = h * 0.2; y < h * 0.8; y += h * 0.15) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      return;
    }

    // Compute data range for scaling
    const min = Math.min(...this.data);
    const max = Math.max(...this.data);
    const range = Math.max(max - min, 0.001);
    const margin = h * 0.1;

    const scaleY = (h - 2 * margin) / range;
    const offsetY = margin;

    // Draw grid lines
    ctx.strokeStyle = '#1A1A1F';
    ctx.lineWidth = 0.5;
    for (let y = margin; y <= h - margin; y += (h - 2 * margin) / 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw the PPG trace
    ctx.beginPath();
    ctx.strokeStyle = '#4ECDC4';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#4ECDC4';
    ctx.shadowBlur = 8;

    const n = this.data.length;
    const stepX = w / Math.max(this.maxPoints - 1, 1);
    const startX = w - (n - 1) * stepX;

    for (let i = 0; i < n; i++) {
      const x = startX + i * stepX;
      const y = h - ((this.data[i] - min) * scaleY + offsetY);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Remove shadow for fill
    ctx.shadowBlur = 0;

    // Subtle gradient fill under the curve
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(78, 205, 196, 0.15)');
    gradient.addColorStop(1, 'rgba(78, 205, 196, 0.0)');

    ctx.lineTo(startX + (n - 1) * stepX, h);
    ctx.lineTo(startX, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  clear() {
    this.data = new Float64Array(0);
    this.draw();
  }
}
