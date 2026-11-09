# Local Android build

## Compatibility check performed

At audit time this Mac reports Intel `x86_64`, macOS 13.7.8, Node 26.13.0 and npm 11.20.0. Expo SDK 58's published Node engine range includes Node 26. Xcode is present; Android SDK environment variables, `adb` and `sdkmanager` were not found. The machine has 4 GB RAM and about 61 GB free disk at the time checked.

Temurin JDK 17.0.21 was installed per-user at `$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home` from the official Intel macOS archive after verifying its SHA-256. The Android command-line tools archive was checked against Google's repository metadata, but the transfer was stopped after only 6.7 MB arrived in over five minutes. The Android SDK is therefore still missing, and Gradle cannot run yet.

The generated project uses Gradle 9.4.1 and React Native 0.88.1. Its dependency catalog specifies Android compile SDK 37, target SDK 36, Build Tools 37.0.0 and NDK 27.1.12297006. A physical-device build is preferable to an Android emulator on 4 GB RAM. Use the x86_64 macOS command-line tools, not ARM-only packages.

## Prerequisites to install locally

- The installed JDK 17, selected through `JAVA_HOME`.
- Android SDK command-line tools for macOS x86_64, platform tools, Android platform 37, Build Tools 37.0.0 and NDK 27.1.12297006.
- `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) and `adb` on `PATH`.
- A USB-debuggable Android device for low-memory device testing.

Install Google's command-line tools archive into `$ANDROID_HOME/cmdline-tools/latest`, then run:

```bash
export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
sdkmanager --install "platform-tools" "platforms;android-37" "build-tools;37.0.0" "ndk;27.1.12297006"
yes | sdkmanager --licenses
java -version
adb version
```

## Commands

From `mobile/`:

```bash
npm install
npx expo start
npx expo start --android
npx expo prebuild --platform android
cd android
./gradlew --no-daemon assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is expected at `mobile/android/app/build/outputs/apk/debug/app-debug.apk` after a successful Gradle build. `expo start --android` launches a development session; it does not create an installable standalone APK.

To copy the built APK onto a connected phone without installing it immediately:

```bash
adb push app/build/outputs/apk/debug/app-debug.apk /sdcard/Download/ShopFlow-debug.apk
```

Alternatively, transfer that APK file by USB and open it from the phone's Downloads folder; Android may ask you to allow installation from that file manager.

For a signed release APK, create a private keystore locally, configure signing values through untracked local Gradle properties or environment variables, and run `./gradlew --no-daemon assembleRelease`. Never commit the keystore or passwords. A release artifact is not promised until the build and installation are verified.

## Current limitation

No APK has been generated. The JDK is installed, but this checkout still lacks the Android SDK and command-line tools required for Gradle. Phases 1–3 pass TypeScript, repository/SQLite tests and an Expo Android bundle export; those checks are not a native APK build or device test.
