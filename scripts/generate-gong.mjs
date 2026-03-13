#!/usr/bin/env node
// scripts/generate-gong.mjs
// Pre-renders the gong sound to a WAV file for Android local notifications.
// Run: node scripts/generate-gong.mjs
//
// Output: android/app/src/main/res/raw/gong.wav
//
// Uses the same synthesis parameters as src/timer/gong.js (post-lengthening).

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../android/app/src/main/res/raw/gong.wav');

const SAMPLE_RATE = 44100;
const DURATION    = 15.0;  // seconds — matches the updated gong.js
const NUM_SAMPLES = Math.round(SAMPLE_RATE * DURATION);

// Synthesis parameters — kept in sync with gong.js
const BASE_FREQ  = 220; // A3 — above phone speaker rolloff, avoids chassis resonance
const HARMONICS  = [1, 2.5, 3.2, 4.1, 5.7]; // inharmonic for metallic timbre
const WEIGHTS    = [1, 0.6, 0.4, 0.3, 0.2];

const pcm = new Float32Array(NUM_SAMPLES);

for (let i = 0; i < NUM_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    let sample = 0;
    HARMONICS.forEach((h, idx) => {
        const amp = WEIGHTS[idx] * Math.exp(-0.3 * t); // slow decay → longer sustain
        sample += amp * Math.sin(2 * Math.PI * BASE_FREQ * h * t);
    });
    const envelope = t < 0.05 ? t / 0.05 : Math.exp(-0.1 * (t - 0.05)); // gentle fade
    pcm[i] = sample * envelope * 0.5;
}

// Convert Float32 → 16-bit signed PCM
const int16 = new Int16Array(NUM_SAMPLES);
for (let i = 0; i < NUM_SAMPLES; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    int16[i] = Math.round(clamped * 32767);
}

// Build WAV file (RIFF/WAVE format, mono, 16-bit PCM)
function buildWav(int16Data, sampleRate) {
    const numChannels  = 1;
    const bitsPerSample = 16;
    const dataSize     = int16Data.length * 2;
    const buf          = Buffer.alloc(44 + dataSize);

    buf.write('RIFF',  0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write('WAVE',  8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);                                             // fmt chunk size
    buf.writeUInt16LE(1,  20);                                             // PCM
    buf.writeUInt16LE(numChannels,  22);
    buf.writeUInt32LE(sampleRate,   24);
    buf.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);   // byte rate
    buf.writeUInt16LE(numChannels * bitsPerSample / 8, 32);                // block align
    buf.writeUInt16LE(bitsPerSample, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < int16Data.length; i++) {
        buf.writeInt16LE(int16Data[i], 44 + i * 2);
    }
    return buf;
}

const wav = buildWav(int16, SAMPLE_RATE);
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, wav);
console.log(`Generated: ${OUTPUT_PATH}  (${(wav.length / 1024).toFixed(0)} KB)`);
