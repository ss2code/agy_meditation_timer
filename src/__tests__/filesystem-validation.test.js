import { describe, it, expect } from 'vitest';

describe('session ID validation', () => {
    it('rejects path traversal attempts', () => {
        const isValid = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
        expect(isValid('ses_1234567890')).toBe(true);
        expect(isValid('ses-abc-123')).toBe(true);
        expect(isValid('../etc/passwd')).toBe(false);
        expect(isValid('ses_123/../../data')).toBe(false);
        expect(isValid('')).toBe(false);
        expect(isValid(null)).toBe(false);
    });
});
