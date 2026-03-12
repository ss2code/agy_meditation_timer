// timer.js — Timer state and control logic
//
// Uses wall-clock time (Date.now()) instead of counting setInterval ticks.
// This ensures the timer stays accurate even when the OS throttles/freezes
// intervals (e.g. Android screen-off, iOS background).

import { Gong } from './gong.js';
import { formatTime } from '../utils/date-helpers.js';
import { scheduleBackgroundGongs, cancelBackgroundGongs } from './background-gong.js';

export const gong = new Gong();

/** @type {number} Elapsed seconds in the current session */
export let elapsedTime = 0;

/** @type {number|null} setInterval ID */
let timerId = null;

/** @type {string|null} ISO timestamp when current session started */
export let sessionStartTimestamp = null;

/** @type {number|null} Date.now() when timer was last started/resumed */
let _resumeWallTime = null;

/** @type {number} Seconds accumulated before the most recent pause */
let _accumulatedBeforePause = 0;

/** @type {number} Last elapsedTime at which gong rules were evaluated */
let _lastGongCheckTime = 0;

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

/** Recompute elapsedTime from wall clock */
function _syncElapsed() {
    if (_resumeWallTime === null) return;
    const wallSeconds = Math.floor((Date.now() - _resumeWallTime) / 1000);
    elapsedTime = _accumulatedBeforePause + wallSeconds;
}

/** Check and fire any gong events between _lastGongCheckTime and elapsedTime */
function _checkGongs(prevTime, currTime) {
    for (let t = prevTime + 1; t <= currTime; t++) {
        if (t === 15) {
            gong.play(1);
        } else if (t > 0 && t % 900 === 0) {
            gong.play(t / 900);
        }
    }
}

/**
 * Start the timer.  No-op if already running.
 */
export function startTimer() {
    if (timerId) return;

    gong.init(); // Requires user gesture — must be called here
    sessionStartTimestamp = sessionStartTimestamp || new Date().toISOString();
    _resumeWallTime = Date.now();

    timerId = setInterval(() => {
        const prevElapsed = elapsedTime;
        _syncElapsed();

        if (onTickCallback) onTickCallback(elapsedTime);

        // Fire gongs for any seconds we skipped over (handles throttled intervals)
        _checkGongs(_lastGongCheckTime, elapsedTime);
        _lastGongCheckTime = elapsedTime;
    }, 1000);
}

/**
 * Pause the timer.
 */
export function pauseTimer() {
    if (!timerId) return;
    clearInterval(timerId);
    timerId = null;

    // Snapshot elapsed into accumulator so resume continues from here
    _syncElapsed();
    _accumulatedBeforePause = elapsedTime;
    _resumeWallTime = null;

    cancelBackgroundGongs();
}

/**
 * Finish the session: pause, emit save event, reset state.
 * Only saves if elapsed >= 10s.
 */
export function finishTimer() {
    // Final sync before stopping
    _syncElapsed();
    pauseTimer();

    cancelBackgroundGongs();

    if (elapsedTime >= 10 && onSessionSaveCallback) {
        onSessionSaveCallback({
            duration: elapsedTime,
            startTimestamp: sessionStartTimestamp,
            endTimestamp: new Date().toISOString(),
        });
    }

    elapsedTime = 0;
    sessionStartTimestamp = null;
    _resumeWallTime = null;
    _accumulatedBeforePause = 0;
    _lastGongCheckTime = 0;
}

/**
 * Called when the page becomes visible again (e.g. screen unlock).
 * Cancels background notifications (Web Audio takes over) and syncs elapsed time.
 */
export function handleVisibilityResume() {
    if (!timerId) return;
    cancelBackgroundGongs();
    _syncElapsed();
    if (onTickCallback) onTickCallback(elapsedTime);
    _checkGongs(_lastGongCheckTime, elapsedTime);
    _lastGongCheckTime = elapsedTime;
}

/**
 * Called when the page is hidden (screen locked / app backgrounded).
 * Schedules local notifications so gongs fire even without Web Audio.
 */
export function handleVisibilityHidden() {
    if (!timerId) return;
    _syncElapsed();
    scheduleBackgroundGongs(elapsedTime);
}

/**
 * Jump to a specific time (debug only).
 * @param {number} seconds
 */
export function setElapsedTime(seconds) {
    elapsedTime = seconds;
    _accumulatedBeforePause = seconds;
    _lastGongCheckTime = seconds;
    if (_resumeWallTime !== null) {
        _resumeWallTime = Date.now();
    }
    if (onTickCallback) onTickCallback(elapsedTime);
}

/**
 * Get the current formatted time string.
 * @returns {string}
 */
export function getFormattedTime() {
    return formatTime(elapsedTime);
}

// Auto-sync and background gong management on visibility change
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            handleVisibilityResume();
        } else {
            handleVisibilityHidden();
        }
    });
}
