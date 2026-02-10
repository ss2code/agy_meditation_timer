# How to Verify Gong Sounds

Since waiting for 15, 30, or 45 minutes is impractical for testing, I've added a **Debug Mode** to help you verify the features quickly.

## 1. Open the Developer Console
- **Chrome/Edge**: Right-click anywhere on the page -> **Inspect** -> Click the **Console** tab.
- **Safari**: Right-click -> **Inspect Element** -> **Console** (Enable "Show Develop menu in menu bar" in Safari Preferences > Advanced if you don't see this).

## 2. Test Audio Immediately
To confirm your speakers work and the audio engine is active, type this into the console and press Enter:
```javascript
meditationDebug.testGong()
```
*Note: You must have interacted with the page (clicked anywhere) at least once for audio to play.*

## 3. Fast Forward Time
You can jump the timer to 5 seconds before a gong event.

### Test 15-Second Gong
1. Refresh the page.
2. Click **Start**.
3. In the console, type:
   ```javascript
   meditationDebug.setTime(10)
   ```
   (This sets the timer to 00:10).
4. Wait 5 seconds. You should hear **1 gong** at 00:15.

### Test 15-Minute Gong (1 Strike)
1. Ensure the timer is running.
2. Type:
   ```javascript
   meditationDebug.setTime(895)
   ```
   (This sets timer to 14:55).
3. Wait 5 seconds. At 15:00, you should hear **1 gong**.

### Test 30-Minute Gong (2 Strikes)
1. Ensure the timer is running.
2. Type:
   ```javascript
   meditationDebug.setTime(1795)
   ```
   (This sets timer to 29:55).
3. Wait 5 seconds. At 30:00, you should hear **2 gongs** (spaced apart).
