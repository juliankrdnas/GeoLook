# GeoLook — Context & Project State

> This file is the living reference for the GeoLook project. It is updated with every meaningful version or change and serves as the primary context source for any developer, collaborator, or AI agent working on this codebase.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository & Environment](#3-repository--environment)
4. [Project Structure](#4-project-structure)
5. [Architecture](#5-architecture)
6. [File Reference](#6-file-reference)
7. [State Management](#7-state-management)
8. [Permissions](#8-permissions)
9. [Environment Variables](#9-environment-variables)
10. [Build & Run](#10-build--run)
11. [Version History](#11-version-history)
12. [Pending Work](#12-pending-work)
13. [Known Constraints](#13-known-constraints)

---

## 1. Project Overview

**GeoLook** is a mobile proximity alarm app built with React Native and Expo. The user picks a destination on a map (via Google Places search or long-press) and sets a radius. When the user enters that radius, the app fires an alarm: sound, vibration, and a local notification.

**Primary use case:** people traveling on public transport who want their phone to alert them when they are close to their stop, even if the screen is off.

**Target platforms:** Android (primary), iOS (supported).

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | React Native | 0.81.5 |
| Expo SDK | Expo | ~54.0.33 |
| Navigation | Expo Router | ~6.0.23 |
| Language | TypeScript | ~5.9.2 |
| Map | react-native-maps | 1.20.1 |
| Place search | react-native-google-places-autocomplete | ^2.6.4 |
| GPS | expo-location | ~19.0.8 |
| Background tasks | expo-task-manager | ~14.0.9 |
| Notifications | expo-notifications | ~0.32.17 |
| Audio | expo-av | ~16.0.8 |
| Haptics | expo-haptics | ~15.0.8 |
| Distance calc | geolib | ^3.3.14 |
| Shared state | @react-native-async-storage/async-storage | 2.2.0 |
| Animations | react-native-reanimated | ~4.1.1 |
| Gestures | react-native-gesture-handler | ~2.28.0 |
| Icons | @expo/vector-icons | ^15.0.3 |

**React compiler** is enabled (`experiments.reactCompiler: true` in `app.json`).  
**New Architecture** is enabled (`newArchEnabled: true` in `app.json`).

---

## 3. Repository & Environment

| Item | Value |
|---|---|
| Repository | https://github.com/juliankrdnas/GeoLook |
| Local path | `C:\Dev\GeoLook` |
| OS | Windows |
| Android Studio JBR | `C:\Program Files\Android\Android Studio\jbr` |
| Android SDK | `C:\Users\Julian\AppData\Local\Android\Sdk` |
| NDK version | 27.1.12297006 |
| Android package | `com.anonymous.GeoLook` |

> **Why `C:\Dev\GeoLook`?** The project was moved from a deeply nested OneDrive path to avoid Windows 260-character path limit errors during native C++ builds with ninja/cmake.

### Required files not in Git

- `android/local.properties` — contains `sdk.dir=C:/Users/Julian/AppData/Local/Android/Sdk`
- `android/gradle.properties` — must include `org.gradle.java.home=C:\\Program Files\\Android\\Android Studio\\jbr`
- `.env` — contains the Google Maps API key (see [Environment Variables](#9-environment-variables))

---

## 4. Project Structure

```
C:\Dev\GeoLook\
│
├── app/
│   ├── _layout.tsx              ← Root layout. Imports proximity-task to register it.
│   ├── modal.tsx                ← Placeholder modal screen (unused).
│   └── (tabs)/
│       ├── _layout.tsx          ← Tab navigator config (Home + Explore tabs).
│       ├── index.tsx            ← Main screen: map, search, alarm logic (foreground).
│       └── explore.tsx          ← Placeholder tab (still has Expo template content).
│
├── tasks/
│   └── proximity-task.ts        ← Background task: GPS → distance check → notification.
│
├── components/
│   ├── external-link.tsx        ← Opens URLs in in-app browser on native.
│   ├── haptic-tab.tsx           ← Tab bar button with haptic feedback on iOS.
│   ├── hello-wave.tsx           ← Animated wave component (template, unused in main flow).
│   ├── parallax-scroll-view.tsx ← Scroll view with parallax header (used in Explore).
│   ├── themed-text.tsx          ← Text component that respects light/dark theme.
│   ├── themed-view.tsx          ← View component that respects light/dark theme.
│   └── ui/
│       ├── collapsible.tsx      ← Expandable section component.
│       ├── icon-symbol.tsx      ← SF Symbols (iOS) / MaterialIcons (Android) adapter.
│       └── icon-symbol.ios.tsx  ← iOS-specific SF Symbols implementation.
│
├── constants/
│   └── theme.ts                 ← Color palette (light/dark) and font families.
│
├── hooks/
│   ├── use-color-scheme.ts      ← Re-exports useColorScheme from react-native.
│   ├── use-color-scheme.web.ts  ← Web-specific color scheme hook.
│   └── use-theme-color.ts       ← Returns the right color for current theme.
│
├── assets/
│   ├── images/                  ← App icons, splash screen, logos.
│   └── sounds/
│       └── alarm.wav            ← Alarm sound file (WAV format). ✅ Present.
│
├── scripts/
│   └── reset-project.js         ← Expo utility to reset to a blank project.
│
├── .env                         ← Google Maps API key (not in Git).
├── app.json                     ← Expo config: plugins, permissions, icons.
├── package.json                 ← Dependencies and scripts.
├── tsconfig.json                ← TypeScript config with `@/*` path alias.
└── context.md                   ← This file.
```

---

## 5. Architecture

The alarm runs on **two simultaneous layers** that activate together when the user taps "Activar alarma" and deactivate together on cancel.

### Layer 1 — Foreground (app open)

```
watchPositionAsync (expo-location)
  └─ on position update:
       └─ getDistance() (geolib)
            └─ if distance <= radius AND alarmState === 'active':
                 ├─ Haptics.notificationAsync()
                 ├─ Audio.Sound.createAsync(alarm.wav) → play loop
                 └─ Notifications.scheduleNotificationAsync()
```

- Updates every 20 m moved or every 10 s, whichever comes first.
- Directly updates the `currentDistance` state displayed in the UI.
- Transitions `alarmState` to `'triggered'` when the condition is met.

### Layer 2 — Background (screen off / app minimized)

```
startLocationUpdatesAsync → GEOLOOK_PROXIMITY_TASK (expo-task-manager)
  └─ on each OS location delivery:
       ├─ AsyncStorage.getItem(destination, radius, alarm_active, alarm_triggered)
       └─ getDistance() (geolib)
            └─ if distance <= radius:
                 ├─ AsyncStorage.setItem(alarm_triggered, 'true')  ← prevents repeat
                 └─ Notifications.scheduleNotificationAsync()
```

- On Android: runs as a Foreground Service (persistent notification: "GeoLook activo").
- On iOS: shows the blue location indicator bar.
- Updates every 50 m moved or every 15 s.

### State synchronization between layers

Both layers share state via `AsyncStorage`. The UI writes on activate/cancel; the background task reads on each location update.

```
AsyncStorage keys:
  geolook_destination      → JSON { latitude, longitude }
  geolook_radius           → number (meters, as string)
  geolook_alarm_active     → 'true' | 'false'
  geolook_alarm_triggered  → 'true' | 'false'
```

### Alarm state machine (`alarmState`)

```
idle ──[activate + destination set]──► active ──[distance <= radius]──► triggered
 ▲                                        │                                  │
 └──────────────[cancel]──────────────────┘                                  │
 └──────────────────────────────[dismiss]─────────────────────────────────────┘
```

---

## 6. File Reference

### `app/_layout.tsx`
Root layout. Wraps the app in `ThemeProvider`. Critically, it imports `@/tasks/proximity-task` at module level — this is required by `expo-task-manager` so the task is registered before the OS can invoke it.

### `app/(tabs)/_layout.tsx`
Configures the two-tab navigator. Uses `HapticTab` for tab buttons and reads colors from `constants/theme.ts`.

### `app/(tabs)/index.tsx`
The entire foreground alarm logic lives here. Key responsibilities:
- Request foreground, background, and notification permissions on mount.
- Configure audio mode (`playsInSilentModeIOS: true`, `staysActiveInBackground: true`).
- Render the `MapView` with a `Marker` and `Circle` at the destination.
- Render `GooglePlacesAutocomplete` for destination search.
- Handle long-press on map to set destination manually.
- Manage the `alarmState` state machine.
- Start/stop foreground watcher and background task in sync.
- Display real-time distance in the bottom panel.

Notable implementation detail: `setAlarmState` inside the location watcher callback uses the functional updater form `setAlarmState((prev) => ...)` to avoid stale closure over `alarmState`.

### `app/(tabs)/explore.tsx`
Currently contains the default Expo template content. Marked for replacement (see [Pending Work](#12-pending-work)).

### `tasks/proximity-task.ts`
Exports:
- `PROXIMITY_TASK_NAME = 'GEOLOOK_PROXIMITY_TASK'`
- `STORAGE_KEYS` — object with all four AsyncStorage key strings.

The `TaskManager.defineTask` call is at module root level (mandatory requirement of expo-task-manager).

### `constants/theme.ts`
Exports `Colors` (light/dark palette) and `Fonts` (platform-specific font families using `Platform.select`).

---

## 7. State Management

No external state library is used. State is managed with:

| Mechanism | Used for |
|---|---|
| `useState` | UI state: `userLocation`, `destination`, `selectedRadius`, `currentDistance`, `alarmState`, `errorMsg`, `isLoadingLocation` |
| `useRef` | Mutable non-reactive refs: `mapRef`, `soundRef`, `locationWatcherRef` |
| `AsyncStorage` | Cross-layer shared state between UI and background task |

---

## 8. Permissions

| Permission | Platform | Purpose |
|---|---|---|
| `ACCESS_FINE_LOCATION` | Android | Precise GPS |
| `ACCESS_COARSE_LOCATION` | Android | Fallback GPS |
| `ACCESS_BACKGROUND_LOCATION` | Android | Background task location |
| `FOREGROUND_SERVICE` | Android | Background task wrapper |
| `FOREGROUND_SERVICE_LOCATION` | Android | Foreground service type |
| `NSLocationWhenInUseUsageDescription` | iOS | Foreground GPS |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | iOS | Background GPS |
| Notifications | Both | Local alarm notification |

> **Important:** The user must grant "Always" (not just "While using") for the background task to work when the screen is off. The app shows an `Alert` explaining this if background permission is not granted.

---

## 9. Environment Variables

File: `.env` (excluded from Git via `.gitignore`)

```
EXPO_PUBLIC_GOOGLE_MAPS_KEY=<your-google-maps-api-key>
```

This key is used in `app/(tabs)/index.tsx` via `process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY` for the `GooglePlacesAutocomplete` query.

**Security notes:**
- The `EXPO_PUBLIC_` prefix makes the variable available in the JS bundle (client-side). It is not a server secret.
- Restrict the key in Google Cloud Console to the Android package `com.anonymous.GeoLook` to limit exposure.
- Revoke and regenerate immediately if the key is ever pushed to a public repository.

---

## 10. Build & Run

### Daily development (hot reload)

```bash
# Start Metro bundler — connect phone via Expo Go on the same WiFi
npx expo start
```

### First build / after plugin changes

```bash
# Full native build (needed after app.json plugin changes or new native libs)
npx expo run:android
```

### Manual Gradle build (when Gradle daemon causes issues)

```bash
cd C:\Dev\GeoLook\android
gradlew.bat app:assembleDebug --no-build-cache --no-daemon -x lint -x test
```

### Install APK manually via ADB

```bash
"C:\Users\Julian\AppData\Local\Android\Sdk\platform-tools\adb.exe" install "C:\Dev\GeoLook\android\app\build\outputs\apk\debug\app-debug.apk"
```

### When a full rebuild is required vs. not

| Change type | Requires `run:android`? |
|---|---|
| `.tsx` / `.ts` source files | ❌ Hot reload handles it |
| `app.json` plugin changes | ✅ Yes |
| New library with native code | ✅ Yes |
| `package.json` JS-only library | ❌ `npm install` + restart Metro |

---

## 11. Version History

### v1.1.0 — 2026-07-22 (Map fix)

**Commit:** `fix: add Google Maps API key to AndroidManifest and enable Maps SDK for Android`  
**Branch:** `master`

**Changes:**
- Added `com.google.android.geo.API_KEY` meta-data entry to `android/app/src/main/AndroidManifest.xml` so `react-native-maps` can render Google Maps tiles on Android.
- Enabled **Maps SDK for Android** in Google Cloud Console for the project's API key (previously only Places API was authorized).
- Required a full native rebuild (`npx expo run:android`) to apply the manifest change.

**Google Cloud Console API key configuration (as of this version):**
- Key name: `Maps Platform API Key`
- APIs authorized: Places API (New), Maps SDK for Android
- Restriction type: API restrictions (allowlist)

**Warnings present (non-blocking):**
- `expo-av` is deprecated as of SDK 54 — migration to `expo-audio` needed before SDK 55 upgrade.
- `SafeAreaView` from `react-native` is deprecated — should be replaced with the one from `react-native-safe-area-context`.

---

### v1.0.0 — 2026-07-21 (Initial release)

**Commit:** `Initial commit - GeoLook proximity alarm app`  
**Branch:** `master`

**What was built:**
- Full proximity alarm with foreground + background dual-layer architecture.
- Real-time distance display while alarm is active.
- 5-option configurable alarm radius: 500 m, 1 km, 1.5 km, 2 km, 5 km.
- Destination selection via Google Places Autocomplete search.
- Destination selection via long-press on map.
- Alarm sound (`alarm.wav`) with loop playback, respects iOS silent mode.
- Haptic feedback on alarm trigger and button interactions.
- Local notifications (foreground + background, lock screen visible).
- Android Foreground Service for background location.
- iOS background location indicator (blue bar).
- Permission flow: foreground GPS → background GPS → notifications.
- `alarm.wav` sound file present in `assets/sounds/`.
- API key secured via `.env` (not in Git).
- 3-state alarm machine: `idle → active → triggered`.

**Known issues / not yet done at this version:**  
See [Pending Work](#12-pending-work).

---

## 12. Pending Work

Items are ordered by priority.

### 🔴 None currently blocking

The app is fully functional as of v1.1.0.

### 🟡 Medium priority

| # | Item | File(s) affected |
|---|---|---|
| 1 | Replace `explore.tsx` with something useful (alarm history, settings, or remove the tab) | `app/(tabs)/explore.tsx`, `app/(tabs)/_layout.tsx` |
| 2 | ~~Add Google Maps API key to `AndroidManifest.xml`~~ ✅ Done in v1.1.0 | — |
| 3 | Migrate `expo-av` → `expo-audio` (deprecated in SDK 54, breaks in SDK 55) | `app/(tabs)/index.tsx` |
| 4 | Replace `SafeAreaView` from `react-native` with one from `react-native-safe-area-context` | `app/(tabs)/index.tsx` |
| 5 | Review for implicit `any` TypeScript types across all files | All `.ts` / `.tsx` |

### 🟢 Low priority / Nice to have

| # | Item | Notes |
|---|---|---|
| 6 | Dark mode support in `index.tsx` | Currently uses hardcoded colors. Should use `useThemeColor` / `Colors`. |
| 7 | Visual proximity progress indicator | A ring or progress bar showing how close the user is to the alarm radius. |
| 8 | Alarm history | Save past destinations in AsyncStorage. Show in Explore tab. |
| 9 | Custom radius input | Allow typing an arbitrary radius in addition to the 5 preset chips. |
| 10 | Replace `app/modal.tsx` | Currently a placeholder with Expo template text. |

---

## 13. Known Constraints

| Constraint | Detail |
|---|---|
| Windows path length | Keep project at `C:\Dev\GeoLook\` or another short path. Moving to a deep path (e.g., inside OneDrive) breaks native builds due to Windows 260-char path limit. |
| Expo Go limitations | Background location tasks do **not** work inside Expo Go on iOS. A development build (`npx expo run:ios`) is required for full iOS testing. |
| Background location (Android) | The user must grant "Allow all the time" location permission for the background task to fire with the screen off. |
| `alarm.wav` format | The sound must be WAV. The `expo-notifications` plugin on Android expects the filename (without extension) to match the value passed in `sound`. |
| Task registration | `proximity-task.ts` must be imported at module root level in `_layout.tsx`. Moving the import inside a component or hook will break background task registration. |
| `AsyncStorage` race condition | If the user activates and immediately backgrounds the app, the first background task execution may read `alarm_active` before it is written. In practice the write completes in milliseconds and has not caused issues, but it is worth noting. |
