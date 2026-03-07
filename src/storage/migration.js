// migration.js — Migrate old localStorage format to v2 session schema
// Old format: { id, date, duration, type }  (stored in 'meditation_history')
// New format: full session metadata with startTimestamp, insights, etc.

const MIGRATION_FLAG = 'meditation_migration_v6_complete';
const OLD_KEY = 'meditation_history';

/**
 * Convert an old v1 session to the new v2 schema.
 * @param {Object} old - { id, date, duration, type }
 * @returns {Object} New session metadata
 */
function migrateSession(old) {
    return {
        id: `ses_${old.id}`,
        startTimestamp: null,           // Not recorded in v1
        endTimestamp: old.date,         // Best approximation
        duration: old.duration,
        hasTelemetry: false,
        insights: null,
        type: 'meditation',
        schemaVersion: 2,
        migratedFromV1: true,
    };
}

/**
 * Run migration if not already done.
 * Reads old 'meditation_history', converts to v2, writes via adapter.
 * @param {import('./storage-interface.js').DataStorageInterface} adapter
 * @returns {Promise<{migrated: number}>}
 */
export async function runMigrationIfNeeded(adapter) {
    if (localStorage.getItem(MIGRATION_FLAG)) {
        return { migrated: 0 };
    }

    const raw = localStorage.getItem(OLD_KEY);
    if (!raw) {
        localStorage.setItem(MIGRATION_FLAG, '1');
        return { migrated: 0 };
    }

    let oldSessions;
    try {
        oldSessions = JSON.parse(raw);
    } catch {
        console.warn('[migration] Could not parse old session data');
        localStorage.setItem(MIGRATION_FLAG, '1');
        return { migrated: 0 };
    }

    if (!Array.isArray(oldSessions) || oldSessions.length === 0) {
        localStorage.setItem(MIGRATION_FLAG, '1');
        return { migrated: 0 };
    }

    // Migrate in reverse order (oldest first so newest ends at array head)
    const reversed = [...oldSessions].reverse();
    for (const old of reversed) {
        const session = migrateSession(old);
        await adapter.saveSession(session);
    }

    localStorage.setItem(MIGRATION_FLAG, '1');
    console.log(`[migration] Migrated ${oldSessions.length} sessions from v1 to v2`);
    return { migrated: oldSessions.length };
}
