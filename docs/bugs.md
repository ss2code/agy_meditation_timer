## B001 · Timer screen overflow on Samsung S25 Edge
**Date:** 2026-04-09 | **Regression:** unknown | **Fix:** this session

**Root cause:** The timer view stacked large vertical elements (helper pill, oversized timer typography, roomy controls/cards), which exceeded short effective viewport height on Samsung S25 Edge once three recent sessions rendered.
**What went wrong:** The UI was tuned for more generous vertical space and was not validated against tight-height Android layouts, causing important content to sit below the fold in the default state.
**What should have been done:** Validate timer-screen vertical fit using a short-height viewport profile during UI changes, keep helper copy optional/non-blocking, and enforce compact spacing rules for small-height devices.
**Test that would have caught it:**
```js
it('keeps timer screen content visible with 3 recent sessions on short mobile height', async () => {
  setViewport({ width: 412, height: 780 }); // Samsung-like compact height in app webview
  seedSessions(3);
  await renderTimerView();
  expect(screenBottomOf('#historyList')).toBeLessThanOrEqual(viewportBottomExcludingTabBar());
});
```
