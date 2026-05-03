// gong.js — Gong sound synthesis via Web Audio API (additive synthesis)

export class Gong {
    constructor() {
        this.ctx = null;
        this.buffer = null;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this._createGongBuffer();
        } else if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    _createGongBuffer() {
        const duration = 15.0;
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        // Bell-like Chladni partials (circular plate modes) — warmer than the
        // previous metallic ratios, much less harshness in the 700-1300 Hz band
        // where thin-chassis phone speakers struggle.
        const baseFreq = 196; // G3 — warm, still above ~150 Hz chassis rolloff
        const harmonics = [1, 2.0, 2.76, 5.40];
        const weights   = [1.0, 0.45, 0.25, 0.08];
        // Sum of weights = 1.78 → with 0.4 master gain peak ≤ 0.71, no clipping.

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            let sample = 0;

            harmonics.forEach((h, idx) => {
                const amp = weights[idx] * Math.exp(-0.3 * t);
                sample += amp * Math.sin(2 * Math.PI * baseFreq * h * t);
            });

            // Slightly longer attack (80ms) to soften the transient strike.
            const envelope = t < 0.08 ? t / 0.08 : Math.exp(-0.1 * (t - 0.08));
            data[i] = sample * envelope * 0.4;
        }

        this.buffer = buffer;
    }

    _playOnce(time) {
        if (!this.ctx || !this.buffer) return;

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        // Lower initial cutoff softens the metallic edge on small speakers.
        filter.frequency.setValueAtTime(1200, time);
        filter.frequency.exponentialRampToValueAtTime(280, time + 14);

        const gain = this.ctx.createGain();
        // Unity gain — buffer is already at safe peak (~0.71). Extra gain
        // here was the previous source of post-buffer clipping.
        gain.gain.setValueAtTime(1.0, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 15);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        source.start(time);
    }

    /**
     * Play N gong strikes, spaced 7s apart.
     * Async so it can await AudioContext.resume() on mobile/Android
     * where the context may be suspended after inactivity.
     * @param {number} times
     */
    async play(times = 1) {
        this.init();
        if (this.ctx.state !== 'running') {
            try {
                await this.ctx.resume();
            } catch (e) {
                console.warn('[gong] AudioContext resume failed', e);
                return;
            }
        }
        const now = this.ctx.currentTime;
        for (let i = 0; i < times; i++) {
            this._playOnce(now + i * 7.0);
        }
    }
}
