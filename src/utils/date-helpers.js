// date-helpers.js — Pure date/time utility functions

/**
 * Format seconds into a human-readable duration string.
 * @param {number} seconds
 * @returns {string} e.g. "45s", "12m", "1h 30m"
 */
export function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

/**
 * Format seconds as MM:SS for the timer display.
 * @param {number} seconds
 * @returns {string} e.g. "05:30"
 */
export function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Check if two Date objects represent the same calendar day.
 * @param {Date} d1
 * @param {Date} d2
 * @returns {boolean}
 */
export function isSameDay(d1, d2) {
    return (
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate()
    );
}

/**
 * Get the start of the week (Sunday) for the given date.
 * @param {Date} d
 * @returns {Date}
 */
export function getWeekStart(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day;
    const weekStart = new Date(date.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
}

/**
 * Format a Date for the header: full weekday, date, time.
 * @param {Date} d
 * @returns {string}
 */
export function formatHeaderDate(d) {
    const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    };
    return d.toLocaleString([], options);
}

/**
 * Compute the current meditation streak in consecutive days.
 * A day counts if at least one session ended on that day.
 * Counts backwards from today.
 * @param {Array<{endTimestamp: string, startTimestamp: string}>} sessions
 * @returns {number}
 */
export function computeStreak(sessions) {
    if (!sessions.length) return 0;

    const daySet = new Set(sessions.map((s) => {
        const d = new Date(s.endTimestamp || s.startTimestamp);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }));

    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);

    while (daySet.has(cursor.getTime())) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

/**
 * Compute daily meditation minutes for the last N days (oldest first).
 * @param {Array} sessions
 * @param {number} [days=30]
 * @returns {{ labels: string[], data: number[] }}
 */
export function getLast30DaysData(sessions, days = 30) {
    const labels = [];
    const data = [];

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    for (let i = days - 1; i >= 0; i--) {
        const dayStart = new Date(today);
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);

        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);

        const label = dayStart.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const mins = sessions
            .filter((s) => {
                const d = new Date(s.endTimestamp || s.startTimestamp);
                return d >= dayStart && d <= dayEnd;
            })
            .reduce((sum, s) => sum + Math.floor(s.duration / 60), 0);

        labels.push(label);
        data.push(mins);
    }

    return { labels, data };
}
