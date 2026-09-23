# Speed of Sound — Stage 4C.1 Manual Playback Validation Checklist

## Overview
This document specifies the verification protocol for **SoundCloud Full Playback** and the cascade fallback mechanism (`SoundCloud Full` ➔ `SoundCloud Preview` ➔ `iTunes Preview` ➔ `Procedural Web Audio DSP Synth`) across web and mobile Telegram WebView environments.

---

## Target Platforms Matrix

| Environment | Engine / Runtime | HLS Native Support | Status |
| :--- | :--- | :--- | :--- |
| **Desktop Chrome (macOS / Win / Linux)** | Chromium Blink | Audio element with HLS stream / MP3 fallback | MANUAL REQUIRED |
| **Desktop Safari (macOS)** | WebKit Core | Native HLS in `<audio>` | MANUAL REQUIRED |
| **Telegram Android Mini App** | Android System WebView (Chromium) | HLS supported in HTMLAudioElement | MANUAL REQUIRED |
| **Telegram iOS Mini App** | iOS WebKit Safari View | Native HLS engine in HTMLAudioElement | MANUAL REQUIRED |

---

## 1. Primary Full Playback Verification Protocol (>30 Seconds Proof)

For each environment:

### Desktop Chrome / Safari
1. Open Speed of Sound Mini App (`http://localhost:3000` or deployed URL).
2. Generate recommendation via Vibe Radar.
3. Select a track enriched with SoundCloud source (indicated by orange `SOUNDCLOUD FULL` badge in player).
4. Click **PLAY** button.
5. Inspect player counter and confirm continuous audio progression past `00:30` (`currentTime > 30s`).
6. Confirm audio continues playing without interruption or abrupt cutoff at 30 seconds.
7. Click the `[i]` telemetry button on the player display.
8. Confirm:
   - `Provider`: `soundcloud`
   - `Playback Mode`: `full`
   - `Transcoding`: `hls_aac_160` (or `hls_aac_96`)
   - `Stream Resolved`: `YES`
9. Confirm no unintended fallback to iTunes or procedural DSP occurred.

*Status: NOT TESTED (Manual verification on physical browser required)*

---

### Telegram Android Mini App
1. Open bot `@speed_sound_bot` and launch Speed of Sound WebApp inside Telegram for Android.
2. Submit a mood prompt (e.g. "atmospheric garage 134 bpm").
3. Select recommended track with SoundCloud source.
4. Press **PLAY**.
5. Confirm audio starts and plays smoothly through Android media audio session.
6. Verify playback counter reaches `00:31` and continues playing full track.
7. Verify provider badge indicates `SOUNDCLOUD FULL`.
8. Verify no stuttering or premature cutoff.

*Status: NOT TESTED (Physical Android device required)*

---

### Telegram iOS Mini App
1. Open bot `@speed_sound_bot` and launch Speed of Sound WebApp inside Telegram on iOS (iPhone / iPad).
2. Generate playlist.
3. Select track with SoundCloud source and press **PLAY**.
4. Confirm WebKit audio output activates (native HLS decoding).
5. Verify playback counter passes `00:30` (e.g. `00:35`, `00:45`).
6. Confirm audio continues seamlessly past preview boundary.
7. Verify no fallback triggered.

*Status: NOT TESTED (Physical iOS device required)*

---

## 2. Audio Control & Interaction Matrix

| Test Scenario | Action | Expected Result | Result |
| :--- | :--- | :--- | :--- |
| **Screen Lock / Background** | Lock screen during playback | Audio session continues or pauses predictably based on OS policy | NOT TESTED |
| **Pause** | Tap Pause button | Audio freezes immediately, timer stops, visualizer idles | NOT TESTED |
| **Resume** | Tap Play button from pause | Audio resumes from exact timestamp without re-resolving | NOT TESTED |
| **Seek (Scrub)** | Drag scrubber from `00:10` to `01:45` | Playback jumps accurately to target timestamp | NOT TESTED |
| **Next Track** | Tap Next (`>>|`) | Current stream stops, next track sources resolve, playback starts | NOT TESTED |
| **Previous Track** | Tap Prev (`|<<`) | Previous track in playlist loads and plays | NOT TESTED |
| **Volume Slider** | Move volume from 100% to 20% | Gain changes smoothly without clicks | NOT TESTED |
| **Stream Failure Fallback** | Simulate expired/broken URL | Player catches error, invalidates cache, falls back to iTunes preview or procedural synth | TESTED VIA QA |

---

## 3. Strict Matching Criteria Matrix

| Target Track | Candidate Track | Expected Outcome | Verified |
| :--- | :--- | :--- | :--- |
| Burial — Archangel | Burial — Archangel | ACCEPTED (Score >= 80, Full Playback) | PASS |
| Burial — Archangel | Burial — Archangel (DnB Remix) | REJECTED (Unwanted version modifier: remix) | PASS |
| Bicep — Glue | Bicep — Glue (Live at Printworks) | REJECTED (Unwanted version modifier: live) | PASS |
| Four Tet — Baby | Four Tet — Baby (Club Mix) | REJECTED (Unwanted version modifier: club mix) | PASS |
| Overmono — So U Kno | Random Uploader — Completely Other Track | REJECTED (Artist & Title mismatch) | PASS |
| Four Tet & Burial — Nova | Four Tet — Nova | ACCEPTED (Legitimate collaboration match) | PASS |
| Target 240s Track | Candidate 3600s 1hr DJ set | REJECTED (Duration mismatch) | PASS |

---

## 4. Playback Diagnostic Pipeline

The automated diagnostic `runSoundCloudPlaybackDiagnostic()` inspects the 9-stage sequence:

```
Track
  ↓ [1. SEARCH]               -> PASS
  ↓ [2. MATCH]                -> PASS
  ↓ [3. ACCESS]               -> PASS
  ↓ [4. TRANSCODING]          -> PASS
  ↓ [5. STREAM_RESOLUTION]    -> PASS
  ↓ [6. AUDIO_ELEMENT]        -> MANUAL REQUIRED (browser only)
  ↓ [7. CAN_PLAY]             -> MANUAL REQUIRED (browser only)
  ↓ [8. PLAY]                 -> MANUAL REQUIRED (browser only)
  ↓ [9. PLAYBACK_30S]         -> MANUAL REQUIRED (browser only)
```

In headless Node.js CI environments, stages 1–5 are validated deterministically via API mocks and real smoke tests, while stages 6–9 are correctly and honestly flagged as `MANUAL REQUIRED` to prevent false confidence.

A real browser/WebView media runtime is required for actual HTMLAudioElement playback validation (including loadedmetadata, canplay, playing, timeupdate, and currentTime > 30 checks). Physical audio output is required only to verify audible playback from the user's perspective.
