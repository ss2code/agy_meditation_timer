import { describe, it, expect } from 'vitest';
import { parseCSV, toCSV } from './csv.js';

describe('parseCSV', () => {
    it('parses simple numeric CSV', () => {
        const csv = 'a,b,c\n1,2,3\n4,5,6';
        expect(parseCSV(csv)).toEqual([
            { a: 1, b: 2, c: 3 },
            { a: 4, b: 5, c: 6 },
        ]);
    });

    it('treats empty cell as null', () => {
        const csv = 'a,b\n1,\n,3';
        expect(parseCSV(csv)).toEqual([
            { a: 1, b: null },
            { a: null, b: 3 },
        ]);
    });

    it('preserves ISO timestamp strings', () => {
        const csv = 'ts,hr\n2026-01-01T00:00:00.000Z,72';
        expect(parseCSV(csv)).toEqual([{ ts: '2026-01-01T00:00:00.000Z', hr: 72 }]);
    });

    it('returns empty array for header-only input', () => {
        expect(parseCSV('a,b,c')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
        expect(parseCSV('')).toEqual([]);
    });

    it('handles whitespace around values', () => {
        const csv = 'a , b\n 1 , 2 ';
        expect(parseCSV(csv)).toEqual([{ a: 1, b: 2 }]);
    });
});

describe('toCSV', () => {
    it('serializes rows to CSV string', () => {
        const rows = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
        expect(toCSV(rows)).toBe('a,b\n1,2\n3,4');
    });

    it('respects specified column order', () => {
        const rows = [{ ts: '2026-01-01T00:00:00.000Z', hr: 72, spo2: null }];
        expect(toCSV(rows, ['ts', 'hr', 'spo2'])).toBe('ts,hr,spo2\n2026-01-01T00:00:00.000Z,72,');
    });

    it('outputs empty string for undefined column value', () => {
        const rows = [{ a: 1 }, { a: 2, b: 3 }];
        expect(toCSV(rows, ['a', 'b'])).toBe('a,b\n1,\n2,3');
    });

    it('returns empty string for empty array', () => {
        expect(toCSV([])).toBe('');
    });

    it('round-trips through parseCSV', () => {
        const rows = [
            { timestamp: '2026-01-01T08:00:00.000Z', hr: 72, hrv_rr: 812, skin_temp: null, spo2: 97 },
            { timestamp: '2026-01-01T08:00:01.000Z', hr: 71, hrv_rr: null, skin_temp: 33.2, spo2: null },
        ];
        const cols = ['timestamp', 'hr', 'hrv_rr', 'skin_temp', 'spo2'];
        const csv = toCSV(rows, cols);
        expect(parseCSV(csv)).toEqual(rows);
    });
});
