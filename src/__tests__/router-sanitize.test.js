import { describe, it, expect } from 'vitest';

describe('route param sanitization', () => {
    it('strips dangerous characters from route params', () => {
        const sanitize = (p) => p.replace(/[^a-zA-Z0-9_-]/g, '');
        expect(sanitize('ses_1234')).toBe('ses_1234');
        expect(sanitize('<script>alert(1)</script>')).toBe('scriptalert1script');
        expect(sanitize('../../../etc')).toBe('etc');
        expect(sanitize('valid-id_123')).toBe('valid-id_123');
    });
});
