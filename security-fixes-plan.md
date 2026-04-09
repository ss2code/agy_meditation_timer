# Security Fixes Plan

**Created:** 2026-03-14
**Last reviewed:** 2026-04-09
**Priority order:** Fix items top-to-bottom. Each fix is independent — commit after each one.
**IMPORTANT:** After every code change, bump `APP_VERSION` in `src/main.js` and `CACHE_NAME` in `public/service-worker.js`.

---

## Status Snapshot (2026-04-09)

### Completed from original plan
- Fix 2: HTML escaping added and covered by tests.
- Fix 3: CSP is present in `index.html`.
- Fix 4: Session ID validation added in filesystem adapter.
- Fix 5: Router param sanitization added.
- Fix 6: Health Connect write permissions removed from release manifest and kept in debug manifest.
- Fix 7: `android:allowBackup="false"` is set.
- Fix 8: Outfit is self-hosted from `public/fonts`.

### Partially complete
- None.

### Not completed yet
- Fix 9: CACHE_NAME bumping is still manual.

---

## Queued for Next Session

### Q1 (High): Fully remove Dev Panel path from production builds

**Status:** Completed on 2026-04-09.

**Verification run:**
```bash
npm run build
rg -n "meditationDebug|Dev Mode|_simulateBioSession|_toggleDevPanel" www
```
Result: no matches in production build output.

### Q2 (Medium): Resolve current `npm audit` production findings

**Status:** Completed on 2026-04-09.

**Fix applied:**
- Moved `@capacitor/cli` and `@capacitor/ios` from `dependencies` to `devDependencies`.
- Reinstalled lockfile dependencies.

**Verification run:**
```bash
npm audit --omit=dev
```
Result: `0` prod vulnerabilities.

### Q3 (Low/Optional): Automate service-worker cache name bumping

**Status:** Completed on 2026-04-09.

**Fix applied:**
- Added Vite build plugin `sw-cache-buster` in `vite.config.js`.
- Plugin rewrites `www/service-worker.js` `CACHE_NAME` after build using a content hash of `www/index.html`.

**Verification run:**
```bash
npm run build
rg -n "const CACHE_NAME" www/service-worker.js
```
Result example: `const CACHE_NAME = 'meditation-timer-468493b0ef';`

---

## Fix 1: Guard debug tools behind DEV-only flag [Medium]

**Problem:** `window.meditationDebug` (with live storage access) and the Dev Debug panel are exposed in production builds. The dev panel can seed fake Health Connect data on a real device.

### Steps

**1a. Guard `window.meditationDebug` in `src/main.js`**

Find the block near line 259 that does:
```js
window.meditationDebug = { ... };
```
Wrap it:
```js
if (import.meta.env.DEV) {
    window.meditationDebug = { ... };
}
```

**1b. Guard the Dev Debug button in `src/ui/views/dashboard-view.js`**

Find the "Dev Debug" button rendering (near line 64–69). Wrap the button HTML in a conditional so it only renders when `import.meta.env.DEV` is true. The simplest approach: make the button HTML a separate string variable and conditionally include it:
```js
const devButton = import.meta.env.DEV
    ? `<button id="dev-debug-btn" class="dev-debug-btn">Dev Debug</button>`
    : '';
```
Then use `${devButton}` in the template literal where the button currently sits.

Also wrap the button's event listener setup (the `addEventListener` for `dev-debug-btn`) in the same `if (import.meta.env.DEV)` guard.

**1c. Guard dev panel functions in `src/main.js`**

The `_toggleDevPanel()` and `_simulateBioSession()` functions (roughly lines 64–215) are only called from the debug object and dev button. Wrap their definitions in `if (import.meta.env.DEV) { ... }` so Vite tree-shakes them from production.

### Tests to validate

Run `npm test` — all existing tests should pass (none depend on `window.meditationDebug`).

**New tests to add** in a new file `src/__tests__/dev-guards.test.js`:
```js
import { describe, it, expect } from 'vitest';

describe('dev guards', () => {
    it('meditationDebug is not defined in production', () => {
        // In test env (which uses import.meta.env.DEV = true by default in vitest),
        // we verify the guard exists by checking the source code pattern.
        // This is a documentation test — the real validation is that
        // `npm run build` followed by grep shows no meditationDebug in output.
    });
});
```

Actually, the better validation: after making the change, run:
```bash
npm run build && grep -r "meditationDebug" www/
```
This should return **no results**, confirming tree-shaking removed it.

---

## Fix 2: Add HTML escaping for innerHTML with storage data [Medium]

**Problem:** Session data from storage (session.id, telemetrySource, telemetryReason, sessionQuality) is interpolated directly into `innerHTML` template literals. A malicious value in storage could execute arbitrary JavaScript.

### Steps

**2a. Create an `escapeHtml` utility**

Add to `src/utils/escape-html.js`:
```js
export function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
```

**2b. Apply escaping in `src/ui/views/session-view.js`**

Import `escapeHtml` at the top.

Find all template literal interpolations that use session data inside `innerHTML` assignments. Key locations:
- The `_diagnosticsPanel` function (around line 241–260): escape `src` (telemetrySource) and `reason` (telemetryReason) before interpolating
- The `_insightsCard` function: escape `session.insights.sessionQuality` if used in HTML
- Any `data-id="${session.id}"` attributes: escape `session.id`

Example fix in `_diagnosticsPanel`:
```js
// Before:
`<p><strong>Source:</strong> ${src}${reason ? ` — ${reason}` : ''}</p>`
// After:
`<p><strong>Source:</strong> ${escapeHtml(src)}${reason ? ` — ${escapeHtml(reason)}` : ''}</p>`
```

**2c. Apply escaping in `src/ui/views/dashboard-view.js`**

Import `escapeHtml`. Find `data-id="${session.id}"` (around line 42) and escape the session ID:
```js
`data-id="${escapeHtml(session.id)}"`
```

Also escape any other session fields rendered in the dashboard HTML (duration display text, date text, etc. — check what's interpolated).

**2d. Apply escaping in `src/ui/views/timer-view.js`**

Import `escapeHtml`. Check around lines 372–376 for any storage-derived values in innerHTML. Escape them.

### Tests to validate

Run `npm test` — all existing tests should pass.

**New test** — add `src/__tests__/escape-html.test.js`:
```js
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
```

---

## Fix 3: Add Content Security Policy [Medium]

**Problem:** No CSP restricts what scripts/styles can run. Any injection is unconstrained.

### Steps

**3a. Add CSP meta tag to `index.html`**

Add this inside `<head>`, before any other tags:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self';">
```

Notes:
- `'unsafe-inline'` is needed for styles because Chart.js sets inline styles on canvas elements
- `data:` and `blob:` for `img-src` may be needed by Chart.js for chart rendering
- `connect-src 'self'` allows fetch to same origin (needed for service worker)
- Do NOT add `'unsafe-eval'` — if something breaks, find the specific cause

**3b. Test thoroughly**

After adding the CSP:
1. Run `npm run dev` and open in browser
2. Open browser console — check for CSP violation errors
3. Start a timer, let it run, finish it — verify no CSP errors
4. Navigate to History, open a session, check the charts render
5. Check that the font loads correctly

If Chart.js fails, you may need to add `'unsafe-inline'` to `script-src` — but try without it first.

### Tests to validate

Run `npm test` — CSP doesn't affect Vitest (no browser).

Manual verification only (see 3b above). The CSP is a defense-in-depth measure — if it causes issues, it's better to have a slightly permissive CSP than none at all.

---

## Fix 4: Validate session IDs before filesystem operations [Low]

**Problem:** Session IDs from migrated v1 data could contain path traversal characters (`../`), potentially escaping the intended storage directory.

### Steps

**4a. Add validation in `src/storage/filesystem-adapter.js`**

Add a validation function at the top of the file:
```js
function _validateId(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new Error(`Invalid session ID: ${id}`);
    }
}
```

Call `_validateId(session.id)` at the start of `saveSession()`, and `_validateId(sessionId)` at the start of `getSession()`, `deleteSession()`, `saveTelemetry()`, and `getTelemetry()`.

### Tests to validate

Run `npm test` — existing tests should pass (all test IDs are alphanumeric with underscores).

**New test** — add to the existing filesystem adapter test file (or create `src/__tests__/filesystem-validation.test.js`):
```js
import { describe, it, expect } from 'vitest';

describe('session ID validation', () => {
    it('rejects path traversal attempts', () => {
        // Test the validation regex directly
        const isValid = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
        expect(isValid('ses_1234567890')).toBe(true);
        expect(isValid('ses-abc-123')).toBe(true);
        expect(isValid('../etc/passwd')).toBe(false);
        expect(isValid('ses_123/../../data')).toBe(false);
        expect(isValid('')).toBe(false);
        expect(isValid(null)).toBe(false);
    });
});
```

---

## Fix 5: Sanitize hash router params [Low]

**Problem:** Hash route params are passed directly from `window.location.hash` to storage lookups and could be a future XSS vector if params are ever rendered.

### Steps

**5a. Add param sanitization in `src/ui/router.js`**

In the `_parseHash()` function (around line 29), sanitize params:
```js
function _parseHash() {
    const hash = window.location.hash.slice(1) || 'timer';
    const [view, ...parts] = hash.split('/');
    // Sanitize params — allow only safe characters
    const params = parts.map(p => p.replace(/[^a-zA-Z0-9_-]/g, ''));
    return { view, params };
}
```

### Tests to validate

Run `npm test`.

**New test** — add to existing router tests or create `src/__tests__/router-sanitize.test.js`:
```js
import { describe, it, expect } from 'vitest';

describe('route param sanitization', () => {
    it('strips dangerous characters from route params', () => {
        // Test the sanitization logic directly
        const sanitize = (p) => p.replace(/[^a-zA-Z0-9_-]/g, '');
        expect(sanitize('ses_1234')).toBe('ses_1234');
        expect(sanitize('<script>alert(1)</script>')).toBe('scriptalert1script');
        expect(sanitize('../../../etc')).toBe('etc');
    });
});
```

---

## Fix 6: Remove HC write permissions from production manifest [Low]

**Problem:** Health Connect WRITE permissions are declared but only needed by the dev panel. They expand the permission footprint unnecessarily.

### Steps

**6a. Edit `android/app/src/main/AndroidManifest.xml`**

Remove these three lines (around lines 60–62):
```xml
<uses-permission android:name="android.permission.health.WRITE_HEART_RATE"/>
<uses-permission android:name="android.permission.health.WRITE_OXYGEN_SATURATION"/>
<uses-permission android:name="android.permission.health.WRITE_RESPIRATORY_RATE"/>
```

**6b. Verify the dev panel still works in debug builds**

If the dev panel's "seed HC data" feature is still needed during development, create `android/app/src/debug/AndroidManifest.xml` with just:
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.health.WRITE_HEART_RATE"/>
    <uses-permission android:name="android.permission.health.WRITE_OXYGEN_SATURATION"/>
    <uses-permission android:name="android.permission.health.WRITE_RESPIRATORY_RATE"/>
</manifest>
```
Android's manifest merger will include these only in debug builds.

### Tests to validate

Run `npm test` (JS tests unaffected).

Verify by inspecting the merged manifest:
```bash
cd android && ./gradlew :app:processReleaseManifest && grep -i "WRITE_HEART" app/build/intermediates/merged_manifests/release/AndroidManifest.xml
```
Should return no results.

---

## Fix 7: Set `android:allowBackup="false"` [Low]

**Problem:** App data (including biometric insights) can be backed up via `adb backup` or Google Auto Backup.

### Steps

**7a. Edit `android/app/src/main/AndroidManifest.xml`**

Change:
```xml
android:allowBackup="true"
```
To:
```xml
android:allowBackup="false"
```

### Tests to validate

Run `npm test` (JS tests unaffected). No additional tests needed — this is a one-line config change.

---

## Fix 8: Self-host Google Fonts [Info]

**Problem:** Loading fonts from Google's CDN sends user IP to Google and creates an external dependency. The service worker doesn't cache external origins, so the font requires network on first load.

### Steps

**8a. Download the Outfit font**

```bash
mkdir -p public/fonts
# Download Outfit variable font (woff2)
curl -o public/fonts/outfit-variable.woff2 "https://fonts.gstatic.com/s/outfit/v11/QGYyz_MVcBeNP4NjuGObqx1XmO1I4TC1C4G-EiAou6Y.woff2"
```

**8b. Add @font-face to `src/style.css`**

Add at the top of the file:
```css
@font-face {
    font-family: 'Outfit';
    src: url('/fonts/outfit-variable.woff2') format('woff2');
    font-weight: 100 900;
    font-display: swap;
}
```

**8c. Remove Google Fonts links from `index.html`**

Remove these lines:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

**8d. Update the CSP** (if Fix 3 was applied)

Remove `https://fonts.googleapis.com` from `style-src` and `https://fonts.gstatic.com` from `font-src` in the CSP meta tag.

### Tests to validate

Run `npm test`.

Manual check: run `npm run dev`, verify the font renders correctly, check browser console for no 404 on the font file.

---

## Fix 9: Automate CACHE_NAME bumping [Info — process improvement]

**Problem:** Forgetting to bump `CACHE_NAME` causes the service worker to serve stale cached content on device. This is a recurring process risk.

### Steps

**9a. Add a Vite plugin to auto-generate CACHE_NAME**

In `vite.config.js`, add a plugin that writes a hash of the build output into the service worker:

```js
import { createHash } from 'crypto';
import fs from 'fs';

// After build, update CACHE_NAME in service-worker.js with content hash
const swCacheBuster = {
    name: 'sw-cache-buster',
    closeBundle() {
        const sw = fs.readFileSync('www/service-worker.js', 'utf8');
        const hash = createHash('md5')
            .update(fs.readFileSync('www/index.html'))
            .digest('hex')
            .slice(0, 8);
        const updated = sw.replace(
            /CACHE_NAME\s*=\s*['"][^'"]+['"]/,
            `CACHE_NAME = 'meditation-timer-${hash}'`
        );
        fs.writeFileSync('www/service-worker.js', updated);
    }
};
```

Add `swCacheBuster` to the `plugins` array in the Vite config.

**NOTE:** This is a nice-to-have. The manual bump process works — this just removes a source of human error. Skip if time-constrained.

### Tests to validate

```bash
npm run build
# Verify CACHE_NAME was updated:
grep "CACHE_NAME" www/service-worker.js
# Should show a hash-based name, not the hardcoded one
```

---

## Checklist

- [x] Fix 1: Guard debug tools behind `import.meta.env.DEV`
- [x] Fix 2: Add `escapeHtml` utility and apply to all innerHTML interpolations
- [x] Fix 3: Add Content Security Policy meta tag
- [x] Fix 4: Validate session IDs in filesystem adapter
- [x] Fix 5: Sanitize hash router params
- [x] Fix 6: Remove HC write permissions from production manifest
- [x] Fix 7: Set `android:allowBackup="false"`
- [x] Fix 8: Self-host Google Fonts
- [x] Fix 9: Automate CACHE_NAME bumping (optional)
- [x] Q2: Resolve `npm audit --omit=dev` findings from 2026-04-09
- [ ] After all fixes: run `npm test`, verify all pass
- [ ] After all fixes: run `npm run build && npm run preview`, smoke-test in browser
