import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../utils/escape-html.js';

describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    it('escapes ampersands', () => {
        expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    it('escapes single quotes', () => {
        expect(escapeHtml("it's")).toBe("it&#039;s");
    });

    it('passes through non-strings unchanged', () => {
        expect(escapeHtml(42)).toBe(42);
        expect(escapeHtml(null)).toBe(null);
        expect(escapeHtml(undefined)).toBe(undefined);
    });

    it('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });
});
