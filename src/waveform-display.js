/**
 * Live PPG waveform display with phosphor afterglow, beat markers,
 * and rhythm strip. Renders like a premium medical monitor.
 */

export class WaveformDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = new Float64Array(0);
    this.maxPoints = 600; // 20s at 30fps
    this.prevData = null; // for phosphor afterglow

    // Beat tracking for flash markers and rhythm strip
    this.beatTimes = [];   // frame indices of detected beats
    this.beatFlash = 0;    // decay counter for beat flash

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
    this.draw();
  }

  push(value) {
    const arr = [...this.data, value];
    if (arr.length > this.maxPoints) {
      arr.splice(0, arr.length - this.maxPoints);
    }
    this.prevData = this.data;
    this.data = new Float64Array(arr);
    if (this.beatFlash > 0) this.beatFlash--;
    this.draw();
  }

  /** Mark a beat detection at the current frame */
  markBeat() {
    this.beatTimes.push(this.data.length - 1);
    if (this.beatTimes.length > 40) this.beatTimes.shift();
    this.beatFlash = 12; // flash lasts ~12 frames
  }

  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    if (w === 0 || h === 0) return;

    // Background
    ctx.fillStyle = '#131316';
    ctx.fillRect(0, 0, w, h);

    if (this.data.length < 2) {
      this.drawGrid(ctx, w, h);
      return;
    }

    // Compute range
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] < min) min = this.data[i];
      if (this.data[i] > max) max = this.data[i];
    }
    const range = Math.max(max - min, 0.001);
    const margin = h * 0.08;

    this.drawGrid(ctx, w, h, margin);

    const n = this.data.length;
    const stepX = w / Math.max(this.maxPoints - 1, 1);
    const startX = w - (n - 1) * stepX;

    // ---- Phosphor afterglow: draw previous trace at low opacity ----
    if (this.prevData && this.prevData.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(78, 205, 196, 0.12)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const pn = this.prevData.length;
      const px = w - (pn - 1) * stepX;
      for (let i = 0; i < pn; i++) {
        const x = px + i * stepX;
        const y = h - ((this.prevData[i] - min) * (h - 2 * margin) / range + margin);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // ---- Beat markers: vertical ticks where beats were detected ----
    for (const beatIdx of this.beatTimes) {
      const beatX = startX + beatIdx * stepX;
      if (beatX < 0 || beatX > w) continue;
      const beatVal = this.data[beatIdx];
      const beatY = h - ((beatVal - min) * (h - 2 * margin) / range + margin);

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 107, 53, 0.5)';
      ctx.lineWidth = 1;
      ctx.moveTo(beatX, margin);
      ctx.lineTo(beatX, h - margin);
      ctx.stroke();

      // Small amber dot at beat peak
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255, 107, 53, 0.8)';
      ctx.arc(beatX, beatY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- Main trace ----
    ctx.beginPath();
    ctx.strokeStyle = '#4ECDC4';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#4ECDC4';
    ctx.shadowBlur = 6;

    for (let i = 0; i < n; i++) {
      const x = startX + i * stepX;
      const y = h - ((this.data[i] - min) * (h - 2 * margin) / range + margin);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Gradient fill under trace
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(78, 205, 196, 0.12)');
    gradient.addColorStop(1, 'rgba(78, 205, 196, 0.0)');
    ctx.lineTo(startX + (n - 1) * stepX, h);
    ctx.lineTo(startX, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // ---- Rhythm strip at bottom ----
    this.drawRhythmStrip(ctx, w, h, startX, stepX);
  }

  drawGrid(ctx, w, h, margin = h * 0.08) {
    ctx.strokeStyle = '#1A1A1F';
    ctx.lineWidth = 0.5;
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const y = margin + (h - 2 * margin) * (i / steps);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  /** Small rhythm strip showing recent beat intervals as amber dots */
  drawRhythmStrip(ctx, w, h, startX, stepX) {
    if (this.beatTimes.length < 2) return;

    const stripH = 28;
    const stripY = h - stripH;
    const centerY = stripY + stripH / 2;

    // Background for rhythm strip
    ctx.fillStyle = 'rgba(10, 10, 12, 0.6)';
    ctx.fillRect(0, stripY, w, stripH);

    // Top edge line
    ctx.strokeStyle = '#1A1A1F';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, stripY);
    ctx.lineTo(w, stripY);
    ctx.stroke();

    // Compute RR intervals (in frames) from beat times
    const rrs = [];
    for (let i = 1; i < this.beatTimes.length; i++) {
      rrs.push(this.beatTimes[i] - this.beatTimes[i - 1]);
    }
    if (rrs.length === 0) return;

    const rrMean = rrs.reduce((a, b) => a + b, 0) / rrs.length;
    const rrMax = Math.max(...rrs, rrMean * 1.5);
    const rrMin = Math.min(...rrs, rrMean * 0.5);
    const rrRange = Math.max(rrMax - rrMin, 1);

    // Draw RR interval dots — spaced by time, height by variability
    const dotR = Math.min(4, stripH / 4);
    for (let i = 0; i < rrs.length; i++) {
      const beatIdx = this.beatTimes[i + 1];
      const x = startX + beatIdx * stepX;
      if (x < 2 || x > w - 2) continue;

      const normRR = (rrs[i] - rrMean) / rrRange;
      const y = centerY + normRR * (stripH / 2 - dotR);

      // Color: amber when steady, red when variable
      const variability = Math.abs(rrs[i] - rrMean) / rrMean;
      const r = Math.min(255, 120 + variability * 135);
      const g = Math.max(40, 200 - variability * 160);
      const b = Math.max(20, 50 - variability * 30);
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;

      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Small label
    ctx.fillStyle = '#5C5C58';
    ctx.font = '9px Inter, sans-serif';
    ctx.fillText('RR', 6, stripY + 12);
  }

  clear() {
    this.data = new Float64Array(0);
    this.prevData = null;
    this.beatTimes = [];
    this.beatFlash = 0;
    this.draw();
  }
}
