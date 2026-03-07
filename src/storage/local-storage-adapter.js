// local-storage-adapter.js — DataStorage implementation backed by localStorage
// Used in browser PWA mode. Stores session metadata as JSON arrays.
// Telemetry stored per-session under separate keys to avoid one huge blob.

import { DataStorageInterface } from './storage-interface.js';

const SESSIONS_KEY = 'meditation_sessions_v2';
const MAX_SESSIONS = 250;

export class LocalStorageAdapter extends DataStorageInterface {
    constructor() {
        super();
        this._cache = null; // In-memory cache of session index
    }

    async initialize() {
        // Load into cache on first access
        this._loadCache();
    }

    _loadCache() {
        if (this._cache) return;
        const raw = localStorage.getItem(SESSIONS_KEY);
        this._cache = raw ? JSON.parse(raw) : [];
    }

    _persist() {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(this._cache));
    }

    async saveSession(session) {
        this._loadCache();
        const idx = this._cache.findIndex((s) => s.id === session.id);
        if (idx >= 0) {
            this._cache[idx] = session;
        } else {
            this._cache.unshift(session);
            if (this._cache.length > MAX_SESSIONS) {
                this._cache.length = MAX_SESSIONS;
            }
        }
        this._persist();
    }

    async getSession(sessionId) {
        this._loadCache();
        return this._cache.find((s) => s.id === sessionId) || null;
    }

    async getAllSessions() {
        this._loadCache();
        // Return copies without telemetry (telemetry stored separately)
        return this._cache.map(({ ...s }) => s);
    }

    async saveTelemetry(sessionId, rows) {
        localStorage.setItem(
            `meditation_telemetry_${sessionId}`,
            JSON.stringify(rows)
        );
        // Mark session as having telemetry
        this._loadCache();
        const session = this._cache.find((s) => s.id === sessionId);
        if (session) {
            session.hasTelemetry = true;
            this._persist();
        }
    }

    async getTelemetry(sessionId) {
        const raw = localStorage.getItem(`meditation_telemetry_${sessionId}`);
        return raw ? JSON.parse(raw) : [];
    }

    async deleteSession(sessionId) {
        this._loadCache();
        this._cache = this._cache.filter((s) => s.id !== sessionId);
        this._persist();
        localStorage.removeItem(`meditation_telemetry_${sessionId}`);
    }
}
