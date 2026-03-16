// main.js — App entry point
// Initializes storage, runs migration, mounts all views, and sets up routing.

import './style.css';

import { LocalStorageAdapter } from './storage/local-storage-adapter.js';
import { FilesystemAdapter } from './storage/filesystem-adapter.js';
import { runMigrationIfNeeded } from './storage/migration.js';

function createStorageAdapter() {
    if (window.Capacitor?.isNativePlatform?.()) {
        return new FilesystemAdapter();
    }
    return new LocalStorageAdapter();
}
import { initRouter, navigateTo } from './ui/router.js';
import { mountTabBar } from './ui/components/tab-bar.js';
import { mountTimerView, renderHistory, renderStats } from './ui/views/timer-view.js';
import { mountSessionView, renderSessionView } from './ui/views/session-view.js';
import { mountDashboardView, renderDashboardView } from './ui/views/dashboard-view.js';
import { mountInsightsView, renderInsightsView } from './ui/views/insights-view.js';
import { gong, setElapsedTime, elapsedTime } from './timer/timer.js';
import { analyzeSession } from './bio/bio-math-engine.js';
import { PROFILE_RESTLESS, PROFILE_DEEP, PROFILE_SOMNOLENT } from './bio/mock-data.js';
import * as healthConnect from './bio/health-connect-service.js';
import { initBackgroundGongs, getDiagnosticLogs, clearDiagnosticLogs, getGongIntervalSec, setGongIntervalSec, getUseDefaultSound, setUseDefaultSound } from './timer/background-gong.js';

const APP_VERSION = 'v8.6';

// ── Bio Dev Panel ────────────────────────────────────────────────────────────

const _BIO_PROFILES = {
    restless:  PROFILE_RESTLESS,
    deep:      PROFILE_DEEP,
    somnolent: PROFILE_SOMNOLENT,
};

/**
 * Simulate a session with synthetic bio data from the named profile.
 * Saves to storage and navigates to the session detail view.
 */
async function _simulateBioSession(profileKey, storage) {
    const profile = _BIO_PROFILES[profileKey] || PROFILE_DEEP;
    const insights = analyzeSession(profile);
    const session = {
        id: `ses_biosim_${Date.now()}`,
        startTimestamp: profile.hr[0].timestamp,
        endTimestamp:   profile.hr[profile.hr.length - 1].timestamp,
        duration: 45 * 60,
        hasTelemetry: true,
        insights,
        type: 'meditation',
        schemaVersion: 2,
    };
    await storage.saveTelemetry(session.id, profile);
    await storage.saveSession(session);
    renderHistory();
    renderStats();
    navigateTo('session', [session.id]);
    return insights;
}

/** Toggle the floating Dev Mode panel (toggled by 5 taps on the version footer). */
function _toggleDevPanel(storage) {
    const existing = document.getElementById('dev-panel');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id = 'dev-panel';
    panel.className = 'dev-panel';
    const isNative = window.Capacitor?.isNativePlatform?.();
    panel.innerHTML = `
        <div class="dev-panel-header">
            <span class="dev-panel-title">⚙ Dev Mode</span>
            <button class="dev-close-btn" aria-label="Close">✕</button>
        </div>
        <p class="dev-panel-label">Simulate Bio Session (mock profile → analyzeSession)</p>
        <div class="dev-btn-row">
            <button class="dev-sim-btn" data-profile="restless">Restless</button>
            <button class="dev-sim-btn" data-profile="deep">Deep</button>
            <button class="dev-sim-btn" data-profile="somnolent">Somnolent</button>
        </div>
        <div id="dev-result" class="dev-result"></div>
        <hr style="margin:0.75rem 0;border-color:#eee">
        <p class="dev-panel-label">Gong Diagnostics</p>
        <p class="dev-panel-label" style="font-size:0.7rem;color:#90A4AE">Interval affects both Web Audio and notification timing.<br>Sound affects notification only (Web Audio always plays metallic gong).</p>
        <div class="dev-btn-row" style="gap:0.4rem">
            <button id="dev-interval-btn" class="dev-setting-btn">${getGongIntervalSec() === 900 ? '15 min' : '5 min'}</button>
            <button id="dev-sound-btn" class="dev-setting-btn">${getUseDefaultSound() ? 'Sound: Chime' : 'Sound: Gong'}</button>
        </div>
        <div class="dev-btn-row">
            <button id="dev-gong-log-btn">View Gong Log</button>
            <button id="dev-gong-clear-btn">Clear Log</button>
        </div>
        <div id="dev-gong-log" class="dev-result" style="max-height:300px;overflow-y:auto;font-size:0.65rem;white-space:pre-wrap;display:none"></div>
        ${isNative ? `
        <hr style="margin:0.75rem 0;border-color:#eee">
        <p class="dev-panel-label">Health Connect — Seed & Test (native only)</p>
        <p class="dev-panel-label" style="font-size:0.7rem;color:#90A4AE">Writes 45 min of synthetic Deep-profile data into Health Connect, then queries it back and shows charts in session detail.</p>
        <div class="dev-btn-row">
            <button id="dev-hc-seed-btn">Seed HC Data (45 min)</button>
        </div>
        <div id="dev-hc-result" class="dev-result"></div>
        ` : ''}
    `;
    document.getElementById('app').appendChild(panel);

    panel.querySelector('.dev-close-btn').addEventListener('click', () => panel.remove());
    panel.querySelectorAll('.dev-sim-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const resultEl = document.getElementById('dev-result');
            resultEl.textContent = 'Running…';
            try {
                const ins = await _simulateBioSession(btn.dataset.profile, storage);
                resultEl.textContent =
                    `Quality: ${ins.sessionQuality} · HR: ${ins.avgHR} bpm · ` +
                    `Resp: ${ins.respirationRate?.average ?? '—'} br/m · ` +
                    `Temp Δ: ${ins.skinTemp?.delta ?? '—'}°C`;
            } catch (err) {
                resultEl.textContent = `Error: ${err.message || err}`;
                console.error('[dev sim]', err);
            }
        });
    });

    // Gong interval toggle: 5 min ↔ 15 min
    document.getElementById('dev-interval-btn')?.addEventListener('click', (e) => {
        const newSec = getGongIntervalSec() === 900 ? 300 : 900;
        setGongIntervalSec(newSec);
        e.target.textContent = newSec === 900 ? '15 min' : '5 min';
    });

    // Notification sound toggle: gong.wav ↔ Android chime
    document.getElementById('dev-sound-btn')?.addEventListener('click', (e) => {
        const newVal = !getUseDefaultSound();
        setUseDefaultSound(newVal);
        e.target.textContent = newVal ? 'Sound: Chime' : 'Sound: Gong';
    });

    // Gong diagnostic buttons
    document.getElementById('dev-gong-log-btn')?.addEventListener('click', () => {
        const logEl = document.getElementById('dev-gong-log');
        const logs = getDiagnosticLogs();
        logEl.style.display = logEl.style.display === 'none' ? 'block' : 'none';
        logEl.textContent = logs.length ? logs.join('\n') : '(no log entries)';
    });
    document.getElementById('dev-gong-clear-btn')?.addEventListener('click', () => {
        clearDiagnosticLogs();
        const logEl = document.getElementById('dev-gong-log');
        logEl.textContent = '(cleared)';
    });
    // Health Connect seed button (native only)
    document.getElementById('dev-hc-seed-btn')?.addEventListener('click', async () => {
        const resultEl = document.getElementById('dev-hc-result');
        try {
            resultEl.textContent = 'Checking HC availability…';
            const availability = await healthConnect.checkAvailability();
            if (availability !== 'available') {
                resultEl.textContent = `HC not available on this device: ${availability}`;
                return;
            }

            resultEl.textContent = 'Requesting HC permissions…';
            const { granted, missing } = await healthConnect.requestReadWritePermissions();
            if (!granted) {
                resultEl.textContent = `Permissions not granted. Missing: ${missing.join(', ')}. Open Settings → Health Connect → Meditation Timer to grant manually.`;
                return;
            }

            const DURATION_SECS = 45 * 60; // 45 min
            const endMs   = Date.now();
            const startMs = endMs - DURATION_SECS * 1000;

            resultEl.textContent = 'Seeding HC data… 0%';
            await healthConnect.seedTestData(startMs, DURATION_SECS, (done, total) => {
                resultEl.textContent = `Seeding HC data… ${Math.round((done / total) * 100)}%`;
            });

            resultEl.textContent = 'Querying HC data back…';
            const telemetry = await healthConnect.querySession(
                new Date(startMs).toISOString(),
                new Date(endMs).toISOString()
            );
            if (!telemetry.hr?.length) {
                resultEl.textContent = 'HC query returned no HR data. Try again.';
                return;
            }

            const insights = analyzeSession(telemetry);
            const sessionId = `ses_hcseed_${Date.now()}`;
            const session = {
                id: sessionId,
                startTimestamp: new Date(startMs).toISOString(),
                endTimestamp:   new Date(endMs).toISOString(),
                duration: DURATION_SECS,
                hasTelemetry: true,
                insights,
                type: 'meditation',
                schemaVersion: 2,
            };
            await storage.saveTelemetry(sessionId, telemetry);
            await storage.saveSession(session);
            renderHistory();
            renderStats();

            resultEl.textContent =
                `Done! Quality: ${insights.sessionQuality} · ` +
                `HR: ${insights.avgHR} bpm · Resp: ${insights.respirationRate?.average ?? '—'} br/m`;
            panel.remove();
            navigateTo('session', [sessionId]);
        } catch (err) {
            resultEl.textContent = `Error: ${err.message || err}`;
        }
    });
}

async function boot() {
    // 1. Initialize storage adapter
    const storage = createStorageAdapter();
    await storage.initialize();

    // 2. Migrate old localStorage data (no-op if already done)
    await runMigrationIfNeeded(storage);

    // 2b. Create notification channels (once ever, persisted).
    // Fire-and-forget — has internal timeout, never blocks boot.
    initBackgroundGongs();

    // 3. Mount tab bar
    const appRoot = document.getElementById('app');
    mountTabBar(appRoot);

    // 4. Mount all views (pass storage to each)
    mountTimerView(storage);
    mountSessionView(storage);
    mountDashboardView(storage, import.meta.env.DEV ? () => _toggleDevPanel(storage) : null);
    mountInsightsView(storage);

    // 5. Initialize router with view handlers
    initRouter({
        timer:    () => { renderHistory(); renderStats(); },
        history:  () => renderDashboardView(),
        session:  (params) => renderSessionView(params),
        insights: () => renderInsightsView(),
    });

    // 6. Version footer — long-press (1s) opens dev panel
    const footer = document.getElementById('versionFooter');
    if (footer) {
        footer.textContent = APP_VERSION;
        let _pressTimer = null;
        footer.addEventListener('pointerdown', () => {
            _pressTimer = setTimeout(() => _toggleDevPanel(storage), 1000);
        });
        footer.addEventListener('pointerup', () => clearTimeout(_pressTimer));
        footer.addEventListener('pointercancel', () => clearTimeout(_pressTimer));
    }

    // 7. Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(() => console.log('[SW] Registered'))
            .catch((err) => console.warn('[SW] Registration failed', err));
    }

    // 8. Debug tools (browser console — DEV only, stripped from production builds)
    if (import.meta.env.DEV) {
        window.meditationDebug = {
            setTime: (seconds) => setElapsedTime(seconds),
            testGong: (strikes = 1) => gong.play(strikes),
            jumpToNextGong: () => {
                const t = elapsedTime;
                const next = t < 15 ? 10 : Math.ceil((t + 1) / 900) * 900 - 5;
                setElapsedTime(next);
            },
            // Bio simulation: run a mock profile through analyzeSession() and save a session
            // Usage: await meditationDebug.simulateBioSession('deep')
            //        profiles: 'restless' | 'deep' | 'somnolent'
            simulateBioSession: (profile = 'deep') => _simulateBioSession(profile, storage),
            devPanel: () => _toggleDevPanel(storage),
            storage,
        };
        console.log("Meditation Debug Tools: window.meditationDebug");
    }
}

boot().catch((err) => {
    console.error('[boot] Failed to initialize app:', err);
});
