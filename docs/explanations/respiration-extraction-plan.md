# Refactoring Respiration Extraction from HR/HRV

This plan addresses algorithmic correctness concerning the Nyquist-Shannon sampling theorem for extracting normal breathing rates (12-20 bpm) out of HR data from devices like Samsung Galaxy Watches.

## Proposed Changes

### Bio-Math Engine Source

#### [MODIFY] bio-math-engine.js (file:///Users/shyamsuri/Dev/antigravity/prj_meditation_tmr/src/bio/bio-math-engine.js)
*   **Sample Density Guard**: In `_extractRespiration`, update the guard condition `if (effectiveRate < 0.1) return [];` to `if (effectiveRate < 0.66) return [];`. This enforces an interval of 1.5s or less.
*   **Handle Insufficient Data Gracefully**: In `analyzeSession`, check `computeEffectiveSampleRate(hrv)` and `computeEffectiveSampleRate(hr)` respectively. If the rate is below 0.66 Hz but data is present, introduce a `warning: 'Insufficient sampling rate for accurate respiration detection'` within the `insights.respirationRate` object and set `confidence: 'low'`.
*   **Adjust Filter / FFT**: In `_dominantRespFrequency`, update `RESP_HI` to `0.4` (from 0.6) to reduce higher-frequency noise and accurately target the 0.15 Hz - 0.4 Hz window for normal breathing (~9-24 bpm). `RESP_LO` will remain `0.05` to uphold the capability to detect deep meditation breathing.

---

### Test Suite Updates

#### [MODIFY] bio-math-engine.test.js (file:///Users/shyamsuri/Dev/antigravity/prj_meditation_tmr/src/bio/bio-math-engine.test.js)
*   **Existing HR Respiration Tests**: Several existing tests in the `extractRespirationFromHR` describe block use a 5-second interval (`makeSeries(2700, 5, ...)`), which will now fail the >0.66 Hz threshold. These will be updated to a `1` second interval so they continue to pass.
*   **Existing Analyze Session Tests**: Tests simulating HR-only fallback (like the Health Connect path test) using `5`s intervals will be corrected to `1`s interval.
*   **Implement New Mock Data Tests**: 
    1.  Add `it('detects ~15 bpm for normal resting HR with RSA wave...')`.
    2.  Add `it('detects ~12 bpm for relaxed HR with RSA wave...')`.
    3.  Add `it('flags insufficient sampling density for 5s intervals...')` confirming empty array returned without blowing up.
*   **Update Density Guard Tests**: The previous test `it('returns empty for HR at 30s intervals...')` will be updated/added to assert failure at `5s` interval since $0.2 < 0.66$.

## Verification Plan

### Automated Tests
*   Run the updated unit test suite via `npm test -- src/bio/bio-math-engine.test.js` or `vitest run`.
*   Verify all newly added respiration mock data test cases pass reliably.
*   Verify the 5-second failure case and graceful degradation is correctly handled and tested in `analyzeSession metadata` assertions.
\n\n### Status\n* Completed and Verified: All 68 tests passing.
