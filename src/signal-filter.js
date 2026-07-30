/**
 * Butterworth bandpass filter for PPG signals.
 * 4th-order, 0.7–3 Hz (covers heart rates 42–180 BPM).
 * Implemented as cascaded biquad filters.
 */

class BiquadFilter {
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2;
    this.a1 = a1; this.a2 = a2;
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/**
 * Design a 2nd-order Butterworth filter section.
 * @param {'lowpass'|'highpass'} type
 * @param {number} fc - cutoff frequency in Hz
 * @param {number} fs - sampling frequency in Hz
 */
function designBiquad(type, fc, fs) {
  const omega = 2.0 * Math.PI * fc / fs;
  const sn = Math.sin(omega);
  const cs = Math.cos(omega);
  const alpha = sn / Math.SQRT2; // Q = 1/sqrt(2) for Butterworth

  let b0, b1, b2, a0, a1, a2;

  if (type === 'lowpass') {
    b0 = (1 - cs) / 2;
    b1 = 1 - cs;
    b2 = (1 - cs) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cs;
    a2 = 1 - alpha;
  } else { // highpass
    b0 = (1 + cs) / 2;
    b1 = -(1 + cs);
    b2 = (1 + cs) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cs;
    a2 = 1 - alpha;
  }

  return new BiquadFilter(b0/a0, b1/a0, b2/a0, a1/a0, a2/a0);
}

/**
 * 4th-order Butterworth bandpass filter (cascade of two 2nd-order sections).
 * Passband: 0.7–3 Hz. Sampling rate: ~30 Hz.
 */
export function createBandpassFilter(sampleRate = 30) {
  const hp1 = designBiquad('highpass', 0.7, sampleRate);
  const hp2 = designBiquad('highpass', 0.7, sampleRate);
  const lp1 = designBiquad('lowpass', 3.0, sampleRate);
  const lp2 = designBiquad('lowpass', 3.0, sampleRate);

  const stages = [hp1, hp2, lp1, lp2];

  return {
    process(signal) {
      const result = new Float64Array(signal.length);
      for (let i = 0; i < signal.length; i++) {
        let y = signal[i];
        for (const stage of stages) {
          y = stage.process(y);
        }
        result[i] = y;
      }
      return result;
    },

    reset() {
      for (const stage of stages) stages.reset();
    },
  };
}
