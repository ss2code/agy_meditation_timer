const timerDisplay = document.getElementById('timer');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const historyList = document.getElementById('historyList');
const statToday = document.getElementById('statToday');
const statWeek = document.getElementById('statWeek');
const headerDate = document.getElementById('headerDate');
const versionFooter = document.getElementById('versionFooter');

const APP_VERSION = 'v5.2';

let elapsedTime = 0;
let timerId = null;

// --- History & Persistence ---

function getHistory() {
    const history = localStorage.getItem('meditation_history');
    return history ? JSON.parse(history) : [];
}

function saveSession(durationSeconds) {
    if (durationSeconds < 10) return; // Don't save very short sessions

    const history = getHistory();
    const session = {
        id: Date.now(),
        date: new Date().toISOString(),
        duration: durationSeconds,
        type: 'meditation'
    };

    // Add to beginning
    history.unshift(session);

    // Limit to 250
    if (history.length > 250) {
        history.length = 250;
    }

    localStorage.setItem('meditation_history', JSON.stringify(history));
    renderHistory();
    renderStats();
}

function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

function renderHistory() {
    const history = getHistory();
    const recent = history.slice(0, 3); // Last 3 sessions

    historyList.innerHTML = '';

    if (recent.length === 0) {
        historyList.innerHTML = '<li class="empty-state">No sessions yet</li>';
        return;
    }

    recent.forEach(session => {
        const date = new Date(session.date);
        const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateString = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
            <span>Meditation (${formatDuration(session.duration)})</span>
            <span class="history-time">${dateString}, ${timeString}</span>
        `;
        historyList.appendChild(li);
    });
}

function renderStats() {
    const history = getHistory();
    const now = new Date();

    // Reset counters
    let todaySeconds = 0;
    let weekSeconds = 0;
    let monthSeconds = 0;

    // Helper to check if dates are same day
    const isSameDay = (d1, d2) =>
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();

    // Helper for week (assuming week starts Sunday)
    const getWeekStart = (d) => {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day;
        return new Date(date.setDate(diff));
    };

    const weekStart = getWeekStart(now);
    weekStart.setHours(0, 0, 0, 0);

    history.forEach(session => {
        const sessionDate = new Date(session.date);

        // Today
        if (isSameDay(sessionDate, now)) {
            todaySeconds += session.duration;
        }

        // This Week
        if (sessionDate >= weekStart) {
            weekSeconds += session.duration;
        }

        // This Month
        if (sessionDate.getMonth() === now.getMonth() && sessionDate.getFullYear() === now.getFullYear()) {
            monthSeconds += session.duration;
        }
    });

    statToday.textContent = formatDuration(todaySeconds);
    statWeek.textContent = formatDuration(weekSeconds);
    statMonth.textContent = formatDuration(monthSeconds);
}

// --- Gong Logic ---

class Gong {
    constructor() {
        this.ctx = null;
        this.buffer = null;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.createGongBuffer();
        } else if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    createGongBuffer() {
        // Synthesize a gong sound
        const duration = 10.0;
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        // Parameters for synthesis (additive synthesis)
        const baseFreq = 100; // Low base frequency
        const harmonics = [1, 2.5, 3.2, 4.1, 5.7]; // Inharmonic for metallic sound
        const weights = [1, 0.6, 0.4, 0.3, 0.2];

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            let sample = 0;

            // Add harmonics
            harmonics.forEach((h, idx) => {
                const amp = weights[idx] * Math.exp(-0.5 * t); // Slower decay for longer sound
                sample += amp * Math.sin(2 * Math.PI * baseFreq * h * t);
            });

            // Apply global envelope (attack + decay)
            const envelope = t < 0.05 ? t / 0.05 : Math.exp(-0.2 * (t - 0.05));

            data[i] = sample * envelope * 0.5; // Scale to avoid clipping
        }

        this.buffer = buffer;
    }

    playOnce(time) {
        if (!this.ctx || !this.buffer) return;

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffer;

        // Lowpass filter to dampen the sound slightly over time (simulating material)
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, time);
        filter.frequency.exponentialRampToValueAtTime(100, time + 9);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(1.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 10);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        source.start(time);
    }

    play(times = 1) {
        this.init(); // Ensure context is ready
        const now = this.ctx.currentTime;
        for (let i = 0; i < times; i++) {
            // Space strikes by 5 seconds to allow resonance overlap
            this.playOnce(now + (i * 5.0));
        }
    }
}

const gong = new Gong();

// --- Timer Logic ---

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateDisplay() {
    timerDisplay.textContent = formatTime(elapsedTime);
    document.title = `${formatTime(elapsedTime)} - Meditation`;

    // Update Reset button text based on state
    resetBtn.textContent = (elapsedTime > 0 && !timerId) ? 'Finish' : 'Reset';
}

function startTimer() {
    if (timerId) return;

    // Initialize AudioContext on user gesture
    gong.init();

    startBtn.disabled = true;
    pauseBtn.disabled = false;

    timerId = setInterval(() => {
        elapsedTime++;
        updateDisplay();

        // Gong Rules
        if (elapsedTime === 15) {
            gong.play(1);
        } else if (elapsedTime > 0 && elapsedTime % 900 === 0) { // Every 15 mins (900s)
            const count = elapsedTime / 900;
            gong.play(count);
        }

    }, 1000);
}

function pauseTimer() {
    clearInterval(timerId);
    timerId = null;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    updateDisplay();
}

function resetTimer() {
    pauseTimer();

    // If we have elapsed time, "Reset" acts as "Finish"
    if (elapsedTime > 0) {
        saveSession(elapsedTime);
        elapsedTime = 0;
    }

    updateDisplay();
}

startBtn.addEventListener('click', startTimer);
pauseBtn.addEventListener('click', pauseTimer);
resetBtn.addEventListener('click', resetTimer);

// Header Date Logic
function updateHeaderDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    if (headerDate) {
        headerDate.textContent = now.toLocaleString([], options);
    }
}

// Initialize
setInterval(updateHeaderDate, 1000);
updateHeaderDate();
updateDisplay();
renderHistory();
renderStats();

if (versionFooter) {
    versionFooter.textContent = APP_VERSION;
}

// --- Debug / Testing Helpers ---
window.meditationDebug = {
    // Jump to a specific time (in seconds)
    setTime: (seconds) => {
        elapsedTime = seconds;
        updateDisplay();
        console.log(`Timer set to ${formatTime(elapsedTime)}`);
    },
    // Test the gong sound immediately
    testGong: (strikes = 1) => {
        console.log(`Testing gong with ${strikes} strikes`);
        gong.play(strikes);
    },
    // Fast forward to next gong event
    jumpToNextGong: () => {
        if (elapsedTime < 15) {
            elapsedTime = 10;
        } else {
            const nextInterval = Math.ceil((elapsedTime + 1) / 900) * 900;
            elapsedTime = nextInterval - 5;
        }
        updateDisplay();
        console.log(`Jumped to ${formatTime(elapsedTime)} (5s before gong)`);
    }
};
console.log("Meditation Timer Debug Tools Available via 'window.meditationDebug'");
