# Android application target

This directory contains the checked-in Android host overlay. Tauri generates the webview and Rust wiring in the Android project during `tauri android dev` or `tauri android build`; generated Gradle files are loaded when present.

`MainActivity` must stay in the package declared by the Tauri identifier and extend the generated `TauriActivity`. The biometric implementation is a separate Android library under the plugin crate and is registered by the Rust plugin adapter.

The host is intentionally not a standalone Android application: its generated Tauri sources and `tauri-android` project dependency are supplied by the Tauri build. Do not replace the entry point with a plain Android activity.
