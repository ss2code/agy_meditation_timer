const timerDisplay = document.getElementById('timer');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const historyList = document.getElementById('historyList');
const statToday = document.getElementById('statToday');
const statWeek = document.getElementById('statWeek');
const statMonth = document.getElementById('statMonth');

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
        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
            <span>Meditation (${formatDuration(session.duration)})</span>
            <span class="history-time">${timeString}</span>
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

    startBtn.disabled = true;
    pauseBtn.disabled = false;

    timerId = setInterval(() => {
        elapsedTime++;
        updateDisplay();
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

// Initialize
updateDisplay();
renderHistory();
renderStats();
