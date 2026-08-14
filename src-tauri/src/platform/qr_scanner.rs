//! QR scanning adapters for desktop and mobile targets.

use yobei_core::error::{ErrorCode, Result};

#[cfg(not(target_os = "android"))]
mod desktop {
    use super::*;
    use std::process::Command;
    use std::time::{Duration, Instant};

    const CAPTURE_START_GRACE: Duration = Duration::from_secs(2);
    const CAPTURE_CANCEL_CONFIRMATION: Duration = Duration::from_millis(700);
    const CAPTURE_TIMEOUT: Duration = Duration::from_secs(30);

    pub async fn capture_qr_from_screen(
        window: tauri::Window,
        _app_handle: tauri::AppHandle,
    ) -> Result<String> {
        window.hide().map_err(|error| {
            eprintln!("[yobei] failed to hide window before QR capture: {error}");
            ErrorCode::OperationFailed
        })?;

        let result = tauri::async_runtime::spawn_blocking(|| {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(capture_qr))
        })
        .await;
        if let Err(error) = window.show() {
            eprintln!("[yobei] failed to restore window after QR capture: {error}");
        }
        if let Err(error) = window.set_focus() {
            eprintln!("[yobei] failed to focus window after QR capture: {error}");
        }

        match result {
            Ok(Ok(inner)) => inner,
            Ok(Err(_)) | Err(_) => Err(ErrorCode::OperationFailed),
        }
    }

    /// Decode a QR code from a raw RGBA frame. Returns the first non-empty
    /// payload found, or `None` when no code is present.
    fn decode_qr_from_rgba(width: usize, height: usize, bytes: &[u8]) -> Result<Option<String>> {
        if width == 0 || height == 0 || bytes.len() < width.saturating_mul(height).saturating_mul(4)
        {
            return Err(ErrorCode::DataCorrupt);
        }
        let mut prepared = rqrr::PreparedImage::prepare_from_greyscale(width, height, |x, y| {
            let i = (y * width + x) * 4;
            // Rec. 601 luma from RGBA, 0 = black, 255 = white.
            let (r, g, b) = (bytes[i] as u32, bytes[i + 1] as u32, bytes[i + 2] as u32);
            ((r * 77 + g * 150 + b * 29) >> 8) as u8
        });
        for grid in prepared.detect_grids() {
            if let Ok((_, text)) = grid.decode() {
                if !text.is_empty() {
                    return Ok(Some(text));
                }
            }
        }
        Ok(None)
    }

    fn capture_qr() -> Result<String> {
        let mut clipboard = arboard::Clipboard::new().map_err(|error| {
            eprintln!("[yobei] failed to open clipboard for QR capture: {error}");
            ErrorCode::OperationFailed
        })?;
        let _ = clipboard.clear();
        let initial_processes = capture_processes();
        let initial_foreground = foreground_process();
        launch_snipping_tool()?;
        let launched_at = Instant::now();
        let mut capture_started = false;
        let mut capture_process_seen = false;
        let mut capture_foreground = None;
        let mut cancellation_started_at = None;
        let mut saw_image = false;
        while launched_at.elapsed() < CAPTURE_TIMEOUT {
            std::thread::sleep(Duration::from_millis(100));
            let current_processes = capture_processes();
            let current_foreground = foreground_process();
            let capture_running = match (&initial_processes, &current_processes) {
                (Some(initial), Some(current)) => {
                    let running = current.iter().any(|pid| !initial.contains(pid))
                        || (!current.is_empty() && initial.is_empty());
                    Some(running)
                }
                _ => None,
            };
            let foreground_is_capture = current_foreground
                .zip(current_processes.as_ref())
                .is_some_and(|(foreground, processes)| processes.contains(&foreground));

            let foreground_started = !capture_started
                && launched_at.elapsed() >= CAPTURE_START_GRACE
                && foreground_changed(initial_foreground, current_foreground);
            if capture_running == Some(true) {
                capture_process_seen = true;
            }
            if foreground_is_capture {
                capture_started = true;
                capture_process_seen = true;
                capture_foreground = current_foreground;
                cancellation_started_at = None;
            } else if foreground_started {
                capture_started = true;
                capture_foreground = capture_foreground.or(current_foreground);
                cancellation_started_at = None;
            }
            let detection_fallback = !capture_started
                && !saw_image
                && launched_at.elapsed() >= CAPTURE_START_GRACE
                && capture_running != Some(true)
                && (current_foreground.is_none()
                    || initial_foreground == current_foreground
                    || current_processes.is_none());
            if capture_finished(
                capture_process_seen,
                capture_running,
                capture_foreground,
                current_foreground,
                detection_fallback,
            ) {
                cancellation_started_at.get_or_insert_with(Instant::now);
            }

            let image = match clipboard.get_image() {
                Ok(image) => image,
                Err(_) => {
                    if cancellation_started_at
                        .is_some_and(|started| started.elapsed() >= CAPTURE_CANCEL_CONFIRMATION)
                    {
                        return Err(ErrorCode::Cancelled);
                    }
                    continue;
                }
            };
            saw_image = true;
            if let Some(text) = decode_qr_from_rgba(image.width, image.height, &image.bytes)? {
                return Ok(text);
            }
            if cancellation_started_at
                .is_some_and(|started| started.elapsed() >= CAPTURE_CANCEL_CONFIRMATION)
            {
                return Err(if saw_image {
                    ErrorCode::InvalidQr
                } else {
                    ErrorCode::Cancelled
                });
            }
        }
        Err(if saw_image {
            ErrorCode::InvalidQr
        } else {
            ErrorCode::Cancelled
        })
    }

    fn capture_finished(
        process_seen: bool,
        capture_running: Option<bool>,
        capture_foreground: Option<u32>,
        current_foreground: Option<u32>,
        detection_fallback: bool,
    ) -> bool {
        (process_seen && capture_running == Some(false))
            || capture_foreground
                .zip(current_foreground)
                .is_some_and(|(capture, current)| capture != current)
            || (detection_fallback && capture_running != Some(true))
    }

    fn foreground_changed(initial: Option<u32>, current: Option<u32>) -> bool {
        match (initial, current) {
            (Some(initial), Some(current)) => initial != current,
            (None, Some(_)) => true,
            _ => false,
        }
    }

    #[cfg(windows)]
    fn launch_snipping_tool() -> Result<()> {
        let mut command = Command::new("explorer.exe");
        command.arg("ms-screenclip:");
        hide_console(&mut command);
        command.spawn().map(|_| ()).map_err(|error| {
            eprintln!("[yobei] failed to launch screen capture tool: {error}");
            ErrorCode::OperationFailed
        })
    }

    #[cfg(not(windows))]
    fn launch_snipping_tool() -> Result<()> {
        Err(ErrorCode::UnsupportedPlatform)
    }

    #[cfg(windows)]
    fn capture_processes() -> Option<Vec<u32>> {
        let mut command = Command::new("tasklist");
        command.args(["/FO", "CSV", "/NH"]);
        hide_console(&mut command);
        let output = command.output().ok()?;
        if !output.status.success() {
            return None;
        }
        let names = [
            "ScreenClippingHost.exe",
            "ScreenCaptureHost.exe",
            "SnippingTool.exe",
        ];
        Some(
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| {
                    let fields: Vec<_> = line.split(',').collect();
                    let name = fields.first()?.trim_matches('"');
                    if !names
                        .iter()
                        .any(|candidate| candidate.eq_ignore_ascii_case(name))
                    {
                        return None;
                    }
                    fields.get(1)?.trim_matches('"').parse().ok()
                })
                .collect(),
        )
    }

    #[cfg(not(windows))]
    fn capture_processes() -> Option<Vec<u32>> {
        None
    }

    #[cfg(windows)]
    fn foreground_process() -> Option<u32> {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId,
        };

        unsafe {
            let window = GetForegroundWindow();
            if window.0.is_null() {
                return None;
            }
            let mut process_id = 0;
            if GetWindowThreadProcessId(window, Some(&mut process_id)) == 0 || process_id == 0 {
                None
            } else {
                Some(process_id)
            }
        }
    }

    #[cfg(not(windows))]
    fn foreground_process() -> Option<u32> {
        None
    }

    #[cfg(windows)]
    fn hide_console(command: &mut Command) {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    #[cfg(not(windows))]
    fn hide_console(command: &mut Command) {
        let _ = command;
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn decodes_roundtrip_qr() {
            let payload = "yobei://verify/some-token-123";
            let code = qrcode::QrCode::new(payload).unwrap();
            let modules = code.to_colors();
            let size = code.width();
            let scale = 8;
            let margin = scale * 4;
            let dim = size * scale + margin * 2;
            let mut rgba = vec![255u8; dim * dim * 4];
            for (i, color) in modules.iter().enumerate() {
                if *color == qrcode::Color::Dark {
                    let mx = i % size;
                    let my = i / size;
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let p = (((my * scale + margin + dy) * dim)
                                + (mx * scale + margin + dx))
                                * 4;
                            rgba[p..p + 4].copy_from_slice(&[0, 0, 0, 255]);
                        }
                    }
                }
            }
            let decoded = decode_qr_from_rgba(dim, dim, &rgba)
                .unwrap()
                .expect("should decode");
            assert_eq!(decoded, payload);
        }

        #[test]
        fn foreground_transition_can_detect_cancel_when_process_lookup_is_unavailable() {
            assert!(!capture_finished(false, None, Some(20), Some(20), false));
            assert!(capture_finished(false, None, Some(20), Some(30), false));
        }

        #[test]
        fn process_exit_can_detect_cancel_after_process_was_seen() {
            assert!(!capture_finished(true, Some(true), None, None, false));
            assert!(capture_finished(true, Some(false), None, None, false));
            assert!(!capture_finished(false, Some(false), None, None, false));
        }

        #[test]
        fn resident_capture_process_can_detect_cancel_by_foreground_change() {
            assert!(!capture_finished(
                true,
                Some(true),
                Some(42),
                Some(42),
                false
            ));
            assert!(capture_finished(true, Some(true), Some(42), Some(7), false));
        }

        #[test]
        fn missing_foreground_can_use_cancel_fallback_when_capture_is_not_running() {
            assert!(capture_finished(false, None, None, None, true));
            assert!(!capture_finished(false, Some(true), None, None, true));
        }

        #[test]
        fn missing_initial_foreground_can_detect_capture_start() {
            assert!(foreground_changed(None, Some(42)));
            assert!(!foreground_changed(None, None));
            assert!(!foreground_changed(Some(42), Some(42)));
        }
    }
}

#[tauri::command]
pub async fn capture_qr_from_screen(
    window: tauri::Window,
    app_handle: tauri::AppHandle,
) -> Result<String> {
    desktop::capture_qr_from_screen(window, app_handle).await
}
