// csv.js — CSV serialize/parse utilities for telemetry data

/**
 * Parse a CSV string into an array of objects.
 * First row is treated as the header.
 * @param {string} csvString
 * @returns {Array<Object>}
 */
export function parseCSV(csvString) {
    const lines = csvString.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
        const values = line.split(',');
        const row = {};
        headers.forEach((h, i) => {
            const val = values[i] !== undefined ? values[i].trim() : '';
            row[h] = val === '' ? null : isNaN(Number(val)) ? val : Number(val);
        });
        return row;
    });
}

/**
 * Serialize an array of objects to a CSV string.
 * @param {Array<Object>} rows
 * @param {string[]} [columns] - column order; defaults to keys of first row
 * @returns {string}
 */
export function toCSV(rows, columns) {
    if (rows.length === 0) return '';
    const cols = columns || Object.keys(rows[0]);
    const header = cols.join(',');
    const lines = rows.map((row) =>
        cols.map((c) => (row[c] === null || row[c] === undefined ? '' : row[c])).join(',')
    );
    return [header, ...lines].join('\n');
}
