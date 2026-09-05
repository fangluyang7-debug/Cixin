# Mobile frontend workflow

The mobile frontend is an existing Flutter Android app located at:

```text
apps/mobile-flutter
```

Do not create a new Flutter, Android, React, Vue, or web project for mobile frontend work. Modify the existing Flutter app only.

Primary UI file:

```text
apps/mobile-flutter/lib/main.dart
```

Primary API client file:

```text
apps/mobile-flutter/lib/core/api/api_client.dart
```

Necessary Flutter resources may be changed only when the existing app requires them, for example assets under `apps/mobile-flutter/assets/`.

## Device Policy

Use Android Emulator for mobile frontend development, preview, screenshots, and UI validation.

Do not use the physical Android device unless the user explicitly asks.

Default AVD:

```text
Pixel_API_35
```

Default Flutter device id:

```text
emulator-5554
```

Physical Android device id below is not part of the default mobile frontend workflow:

```text
MVYLXW8PSSQKPBTC
```

Do not use `scrcpy` screenshots for mobile frontend validation. Visual checks should use the Android Emulator window and emulator screenshots.

## Start Emulator

```powershell
E:\Scoop\apps\android-clt\current\emulator\emulator.exe -avd Pixel_API_35
```

Before running or validating UI, confirm the emulator is online:

```powershell
flutter devices
adb devices
```

## Run Mobile App With Backend

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter run -d emulator-5554 --dart-define=ENABLE_BACKEND=true --dart-define=API_BASE_URL=https://apiserver.zeabur.app
```

## Run Mobile App Without Backend

Use this when checking local UI only:

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter run -d emulator-5554
```

## Take Emulator Screenshot

```powershell
adb -s emulator-5554 exec-out screencap -p > screenshots/mobile-emulator.png
```

Create the `screenshots/` directory first if it does not exist.

## Validation

Before reporting mobile UI changes as complete, check:

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter devices
flutter analyze
flutter run -d emulator-5554
```

For backend-connected mobile validation, use:

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter run -d emulator-5554 --dart-define=ENABLE_BACKEND=true --dart-define=API_BASE_URL=https://apiserver.zeabur.app
```

For visual changes, capture or inspect the Android Emulator result. Do not cite a physical phone screenshot as the validation result.
