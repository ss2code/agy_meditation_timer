// timer.js — Timer state and control logic

import { Gong } from './gong.js';
import { formatTime } from '../utils/date-helpers.js';

export const gong = new Gong();

/** @type {number} Elapsed seconds in the current session */
export let elapsedTime = 0;

/** @type {number|null} setInterval ID */
let timerId = null;

/** @type {string|null} ISO timestamp when current session started */
export let sessionStartTimestamp = null;

// Callbacks set by the UI layer
let onTickCallback = null;
let onSessionSaveCallback = null;

/**
 * Register a callback fired every second with updated elapsedTime.
 * @param {function(number): void} fn
 */
export function onTick(fn) {
    onTickCallback = fn;
}

/**
 * Register a callback fired when a session is finished.
 * @param {function({duration: number, startTimestamp: string, endTimestamp: string}): void} fn
 */
export function onSessionSave(fn) {
    onSessionSaveCallback = fn;
}

/** @returns {boolean} */
export function isRunning() {
    return timerId !== null;
}

/**
 * Start the timer.  No-op if already running.
 */
export function startTimer() {
    if (timerId) return;

    gong.init(); // Requires user gesture — must be called here
    sessionStartTimestamp = sessionStartTimestamp || new Date().toISOString();

    timerId = setInterval(() => {
        elapsedTime++;
        if (onTickCallback) onTickCallback(elapsedTime);

        // Gong rules
        if (elapsedTime === 15) {
            gong.play(1);
        } else if (elapsedTime > 0 && elapsedTime % 900 === 0) {
            gong.play(elapsedTime / 900);
        }
    }, 1000);
}

/**
 * Pause the timer.
 */
export function pauseTimer() {
    if (!timerId) return;
    clearInterval(timerId);
    timerId = null;
}

/**
 * Finish the session: pause, emit save event, reset state.
 * Only saves if elapsed >= 10s.
 */
export function finishTimer() {
    pauseTimer();

    if (elapsedTime >= 10 && onSessionSaveCallback) {
        onSessionSaveCallback({
            duration: elapsedTime,
            startTimestamp: sessionStartTimestamp,
            endTimestamp: new Date().toISOString(),
        });
    }

    elapsedTime = 0;
    sessionStartTimestamp = null;
}

/**
 * Jump to a specific time (debug only).
 * @param {number} seconds
 */
export function setElapsedTime(seconds) {
    elapsedTime = seconds;
    if (onTickCallback) onTickCallback(elapsedTime);
}

/**
 * Get the current formatted time string.
 * @returns {string}
 */
export function getFormattedTime() {
    return formatTime(elapsedTime);
}
