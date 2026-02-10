# Calm Meditation Timer

A simple, beautiful meditation timer that tracks your sessions and provides gentle gong sounds to keep you focused.

## Features

- **Clean Interface**: Distraction-free design with a soothing color palette.
- **Meditation History**: Locally saves your sessions and displays recent history and insights (Today, Week, Month).
- **Gong Sounds**:
    - **Initial Gong**: Rings once after **15 seconds** to signal the settling-in period.
    - **Interval Gong**: Rings every **15 minutes** (900 seconds). The number of strikes corresponds to the number of 15-minute intervals completed (e.g., 1 strike at 15m, 2 strikes at 30m, etc.).
- **PWA Support**: Installable as an app on iOS, Android, and Desktop. Works offline.

## How to Use

1.  **Start**: Click the **Start** button to begin the timer. This will also initialize the audio engine slightly before the first sound is needed.
2.  **Pause**: Click **Pause** to temporarily stop the timer.
3.  **Finish/Reset**:
    - If the timer is running or paused with time elapsed, clicking **Finish** saves the session to your history.
    - If the timer is at 00:00, it resets the state.
4.  **Audio**: Ensure your device volume is up. The sounds are synthesized programmatically, so no downloads are required.

## Installation (PWA)

### iOS (iPhone/iPad)
1.  Open the site in **Safari**.
2.  Tap the **Share** button (box with an arrow).
3.  Scroll down and tap **Add to Home Screen**.
4.  Launch the app from your home screen for a full-screen experience.

### Android (Chrome)
1.  Open the site in **Chrome**.
2.  Tap the menu (three dots) or look for the "Add to Home Screen" banner at the bottom.
3.  Tap **Install**.

### Desktop (Chrome/Edge)
1.  Look for the install icon (usually a monitor with a down arrow) in the address bar.
2.  Click it to install as a standalone application.

## Technical Details

- **Stack**: Vanilla HTML, CSS, and JavaScript.
- **Audio**: Uses the **Web Audio API** to synthesize gong sounds in real-time using additive synthesis (sine waves + envelopes + filters). This ensures zero latency and works without external assets.
- **Offline**: Uses a Service Worker to cache all necessary files (`index.html`, `style.css`, `script.js`, `manifest.json`).
