# Respiration Extraction — Current Implementation Notes
**Doc Status:** Current Reference


This document reflects the respiration pipeline currently implemented in `src/bio/bio-math-engine.js`.

## Goal

Estimate breathing rate from available telemetry with explicit source confidence and graceful fallback when data density is insufficient.

## Source Priority in `analyzeSession()`

1. `resp` from Health Connect (direct respiratory rate)
2. RSA extraction from `hrv`
3. RSA extraction from `hr`
4. Insufficient-data fallback with warning

## Core Algorithm (`_extractRespiration`)

- Require enough data points and at least one full analysis window
- Compute effective sample rate with `computeEffectiveSampleRate()`
- Enforce Nyquist-style density guard:
  - reject extraction when effective rate `< 0.66 Hz`
- Resample to uniform 4 Hz via linear interpolation
- Detrend with 25s moving average
- Run 60s sliding windows (30s step)
- In each window, compute dominant frequency in respiratory band using DFT + Hanning + parabolic interpolation
- Return `breathsPerMinute` samples every 30 seconds

## Metadata surfaced to UI

`insights.respirationRate` includes:
- `average`
- `minimum`
- `breathlessPeriodsCount`
- `breathlessTotalSeconds`
- `source` (`health_connect_direct`, `rsa_hrv`, `rsa_hr`, `insufficient_data`)
- `confidence` (`high`, `medium`, `low`, `none`)
- optional `warning` when sample density is too low

## Current test status

`src/bio/bio-math-engine.test.js` covers:
- direct HC respiration path
- HRV/HR fallback paths
- insufficient-density warning behavior
- source/confidence tagging
- torpor + settle-time integration

Latest project baseline: `npm test` => all suites passing (151 tests total as of this update).
