// filesystem-adapter.js — DataStorage backed by @capacitor/filesystem
// Used on native Android/iOS. Falls back gracefully if Filesystem is unavailable.
//
// Directory layout (Documents/MeditationApp/):
//   sessions_index.json            — lightweight index of all sessions
//   sessions/{id}/metadata.json   — full session object
//   sessions/{id}/telemetry.csv   — sparse time-series bio data

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { DataStorageInterface } from './storage-interface.js';

const BASE = 'MeditationApp';
const SESSIONS_DIR = `${BASE}/sessions`;
const INDEX_PATH = `${BASE}/sessions_index.json`;

export class FilesystemAdapter extends DataStorageInterface {
    constructor() {
        super();
        this._indexCache = null;
    }

    async initialize() {
        await _ensureDir(BASE);
        await _ensureDir(SESSIONS_DIR);
        this._indexCache = await this._readIndex();
    }

    async saveSession(session) {
        const i = this._indexCache.findIndex((s) => s.id === session.id);
        if (i >= 0) {
            this._indexCache[i] = session;
        } else {
            this._indexCache.unshift(session);
        }
        await this._writeIndex();

        const dir = `${SESSIONS_DIR}/${session.id}`;
        await _ensureDir(dir);
        await _writeFile(`${dir}/metadata.json`, JSON.stringify(session));
    }

    async getSession(sessionId) {
        try {
            const data = await _readFile(`${SESSIONS_DIR}/${sessionId}/metadata.json`);
            return JSON.parse(data);
        } catch {
            return this._indexCache.find((s) => s.id === sessionId) ?? null;
        }
    }

    async getAllSessions() {
        return [...this._indexCache];
    }

    async saveTelemetry(sessionId, rows) {
        const dir = `${SESSIONS_DIR}/${sessionId}`;
        await _ensureDir(dir);
        // Store as JSON — telemetry is a multi-series object {hr, hrv, temp, spo2, ...}
        await _writeFile(`${dir}/telemetry.json`, JSON.stringify(rows));
        const session = this._indexCache.find((s) => s.id === sessionId);
        if (session) {
            session.hasTelemetry = true;
            await this._writeIndex();
        }
    }

    async getTelemetry(sessionId) {
        try {
            const data = await _readFile(`${SESSIONS_DIR}/${sessionId}/telemetry.json`);
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    async deleteSession(sessionId) {
        this._indexCache = this._indexCache.filter((s) => s.id !== sessionId);
        await this._writeIndex();
        try {
            await Filesystem.rmdir({
                path: `${SESSIONS_DIR}/${sessionId}`,
                directory: Directory.Data,
                recursive: true,
            });
        } catch { /* ignore if not found */ }
    }

    // ─── Private helpers ────────────────────────────────────────────────────

    async _readIndex() {
        try {
            const data = await _readFile(INDEX_PATH);
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    async _writeIndex() {
        await _writeFile(INDEX_PATH, JSON.stringify(this._indexCache));
    }
}

async function _ensureDir(path) {
    try {
        await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true });
    } catch { /* already exists */ }
}

async function _readFile(path) {
    const result = await Filesystem.readFile({
        path,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
    });
    return result.data;
}

async function _writeFile(path, data) {
    await Filesystem.writeFile({
        path,
        data,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
    });
}
