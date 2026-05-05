# Testing Guide
**Doc Status:** Current Reference


## Run Automated Tests

```bash
npm test
```

Current baseline: **151 passing tests**.

Primary coverage areas:
- Timer wall-clock behavior and pause/resume semantics
- Background gong schedule computation
- Bio analysis (settle time, respiration extraction, torpor, session classification)
- Storage migration and utility helpers
- Session-language summary behavior

## Manual Gong Verification (Web)

Use browser DevTools console after pressing **Start**.

### Immediate audio sanity check

```javascript
meditationDebug.testGong()
```

### Jump to upcoming gong boundaries

```javascript
meditationDebug.setTime(10)   // 15s cue in ~5s
meditationDebug.setTime(895)  // 15-min cue in ~5s
meditationDebug.setTime(1795) // 30-min cue in ~5s (2 strikes)
```

## Manual Background Gong Verification (Android)

1. Deploy using `./run.sh` (emulator) or `./deploy-phone.sh` (physical phone).
2. Start a session.
3. Lock the device before the next gong boundary.
4. Confirm notification-driven gong fires while locked.
5. Unlock and verify no duplicate catch-up gong is replayed.

If needed, open Dev panel and inspect Gong Diagnostics logs.

## Health Connect Verification

1. Complete a short session on native Android.
2. Allow Health Connect permission when prompted.
3. Confirm session gets telemetry with source badge **Health Connect** in session view.
4. Use **Update Health Connect** to re-query and verify data refresh.

If HR data is unavailable, confirm fallback behavior:
- session remains saved
- telemetry source becomes `mock`
- session still renders insights and evidence text
