// storage-interface.js — Abstract storage contract
// All adapters must implement these async methods.

export class DataStorageInterface {
    /**
     * Initialize the storage backend (create dirs, run migrations, etc.)
     * @returns {Promise<void>}
     */
    async initialize() {
        throw new Error('Not implemented');
    }

    /**
     * Save or update a session record.
     * @param {Object} session - Full session metadata object
     * @returns {Promise<void>}
     */
    async saveSession(session) {
        throw new Error('Not implemented');
    }

    /**
     * Retrieve a single session by ID (with full metadata + insights).
     * @param {string} sessionId
     * @returns {Promise<Object|null>}
     */
    async getSession(sessionId) {
        throw new Error('Not implemented');
    }

    /**
     * Get all sessions as lightweight index entries (no telemetry).
     * @returns {Promise<Object[]>}
     */
    async getAllSessions() {
        throw new Error('Not implemented');
    }

    /**
     * Save telemetry rows for a session.
     * @param {string} sessionId
     * @param {Array<Object>} rows - time-series data rows
     * @returns {Promise<void>}
     */
    async saveTelemetry(sessionId, rows) {
        throw new Error('Not implemented');
    }

    /**
     * Get telemetry rows for a session.
     * @param {string} sessionId
     * @returns {Promise<Array<Object>>}
     */
    async getTelemetry(sessionId) {
        throw new Error('Not implemented');
    }

    /**
     * Delete a session and its telemetry.
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async deleteSession(sessionId) {
        throw new Error('Not implemented');
    }
}
