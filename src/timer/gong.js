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
        const duration = 15.0; // longer sustain
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        const baseFreq = 220; // A3 — above phone speaker rolloff (~200 Hz), avoids chassis resonance
        const harmonics = [1, 2.5, 3.2, 4.1, 5.7]; // Inharmonic for metallic timbre
        const weights = [1, 0.6, 0.4, 0.3, 0.2];

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            let sample = 0;

            harmonics.forEach((h, idx) => {
                const amp = weights[idx] * Math.exp(-0.3 * t); // slower decay
                sample += amp * Math.sin(2 * Math.PI * baseFreq * h * t);
            });

            const envelope = t < 0.05 ? t / 0.05 : Math.exp(-0.1 * (t - 0.05)); // gentle fade
            data[i] = sample * envelope * 0.5;
        }

        this.buffer = buffer;
    }

    _playOnce(time) {
        if (!this.ctx || !this.buffer) return;

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, time);
        filter.frequency.exponentialRampToValueAtTime(300, time + 14);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(1.5, time);
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
