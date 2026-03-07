import { describe, it, expect, beforeEach } from 'vitest';
import { runMigrationIfNeeded } from './migration.js';
import { MockAdapter } from './mock-adapter.js';

// Provide localStorage mock for node test environment
const _store = {};
global.localStorage = {
    getItem: (k) => _store[k] ?? null,
    setItem: (k, v) => { _store[k] = String(v); },
    removeItem: (k) => { delete _store[k]; },
};

describe('runMigrationIfNeeded', () => {
    beforeEach(() => {
        Object.keys(_store).forEach((k) => delete _store[k]);
    });

    it('does nothing if migration flag is already set', async () => {
        _store['meditation_migration_v6_complete'] = '1';
        const adapter = new MockAdapter(false);
        const result = await runMigrationIfNeeded(adapter);
        expect(result.migrated).toBe(0);
        expect((await adapter.getAllSessions()).length).toBe(0);
    });

    it('does nothing and sets flag if no old data exists', async () => {
        const adapter = new MockAdapter(false);
        const result = await runMigrationIfNeeded(adapter);
        expect(result.migrated).toBe(0);
        expect(_store['meditation_migration_v6_complete']).toBe('1');
        expect((await adapter.getAllSessions()).length).toBe(0);
    });

    it('migrates old sessions and sets migration flag', async () => {
        // Old format is newest-first (like the old localStorage history array)
        const oldSessions = [
            { id: 200, date: '2026-01-02T08:00:00.000Z', duration: 900, type: 'meditation' },
            { id: 100, date: '2026-01-01T10:00:00.000Z', duration: 1800, type: 'meditation' },
        ];
        _store['meditation_history'] = JSON.stringify(oldSessions);

        const adapter = new MockAdapter(false);
        const result = await runMigrationIfNeeded(adapter);

        expect(result.migrated).toBe(2);
        expect(_store['meditation_migration_v6_complete']).toBe('1');

        const sessions = await adapter.getAllSessions();
        expect(sessions.length).toBe(2);

        // Newest session (id=200) should be at head after migration
        expect(sessions[0].id).toBe('ses_200');
        expect(sessions[1].id).toBe('ses_100');
    });

    it('converts old fields to v2 schema', async () => {
        const oldSessions = [
            { id: 42, date: '2026-03-01T09:00:00.000Z', duration: 1200, type: 'meditation' },
        ];
        _store['meditation_history'] = JSON.stringify(oldSessions);

        const adapter = new MockAdapter(false);
        await runMigrationIfNeeded(adapter);

        const sessions = await adapter.getAllSessions();
        const s = sessions[0];
        expect(s.id).toBe('ses_42');
        expect(s.schemaVersion).toBe(2);
        expect(s.migratedFromV1).toBe(true);
        expect(s.hasTelemetry).toBe(false);
        expect(s.insights).toBeNull();
        expect(s.duration).toBe(1200);
        expect(s.endTimestamp).toBe('2026-03-01T09:00:00.000Z');
    });

    it('handles malformed JSON gracefully', async () => {
        _store['meditation_history'] = 'not-valid-json{{{';
        const adapter = new MockAdapter(false);
        const result = await runMigrationIfNeeded(adapter);
        expect(result.migrated).toBe(0);
        expect(_store['meditation_migration_v6_complete']).toBe('1');
    });

    it('handles empty old sessions array', async () => {
        _store['meditation_history'] = '[]';
        const adapter = new MockAdapter(false);
        const result = await runMigrationIfNeeded(adapter);
        expect(result.migrated).toBe(0);
        expect(_store['meditation_migration_v6_complete']).toBe('1');
    });

    it('does not migrate twice on second call', async () => {
        const oldSessions = [{ id: 1, date: '2026-01-01T10:00:00.000Z', duration: 600 }];
        _store['meditation_history'] = JSON.stringify(oldSessions);

        const adapter = new MockAdapter(false);
        await runMigrationIfNeeded(adapter);
        const result2 = await runMigrationIfNeeded(adapter);
        expect(result2.migrated).toBe(0);

        const sessions = await adapter.getAllSessions();
        expect(sessions.length).toBe(1); // Only migrated once
    });
});
