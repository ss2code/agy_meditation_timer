// mock-adapter.js — In-memory storage adapter for dev/testing
// Pre-loaded with synthetic sessions so the UI renders immediately.

import { DataStorageInterface } from './storage-interface.js';

function makeSession(id, minutesAgo, durationMins, quality = null) {
    const end = new Date(Date.now() - minutesAgo * 60 * 1000);
    const start = new Date(end.getTime() - durationMins * 60 * 1000);
    return {
        id: `ses_${id}`,
        startTimestamp: start.toISOString(),
        endTimestamp: end.toISOString(),
        duration: durationMins * 60,
        hasTelemetry: quality !== null,
        insights: quality
            ? {
                  settleTime: { seconds: 180 },
                  avgHR: 62,
                  avgHRV: 45,
                  respirationRate: { average: 5.2, minimum: 3.1, breathlessPeriodsCount: 2 },
                  skinTemp: { start: 33.1, end: 34.6, delta: 1.5, trend: 'rising' },
                  spo2: { average: 97.5, minimum: 96, torpidFlag: false },
                  sessionQuality: quality,
              }
            : null,
        type: 'meditation',
        schemaVersion: 2,
    };
}

const SEED_SESSIONS = [
    makeSession(1, 30,      45, 'deep_absorption'),
    makeSession(2, 60 * 6,  30, 'absorbed'),
    makeSession(3, 60 * 25, 20, 'settling'),
    makeSession(4, 60 * 49, 60, 'deep_absorption'),
    makeSession(5, 60 * 73, 15, 'restless'),
];

export class MockAdapter extends DataStorageInterface {
    constructor(preload = true) {
        super();
        this._sessions = preload ? [...SEED_SESSIONS] : [];
        this._telemetry = new Map();
    }

    async initialize() {}

    async saveSession(session) {
        const idx = this._sessions.findIndex((s) => s.id === session.id);
        if (idx >= 0) {
            this._sessions[idx] = session;
        } else {
            this._sessions.unshift(session);
        }
    }

    async getSession(sessionId) {
        return this._sessions.find((s) => s.id === sessionId) || null;
    }

    async getAllSessions() {
        return [...this._sessions];
    }

    async saveTelemetry(sessionId, rows) {
        this._telemetry.set(sessionId, rows);
        const session = this._sessions.find((s) => s.id === sessionId);
        if (session) session.hasTelemetry = true;
    }

    async getTelemetry(sessionId) {
        return this._telemetry.get(sessionId) || [];
    }

    async deleteSession(sessionId) {
        this._sessions = this._sessions.filter((s) => s.id !== sessionId);
        this._telemetry.delete(sessionId);
    }
}
