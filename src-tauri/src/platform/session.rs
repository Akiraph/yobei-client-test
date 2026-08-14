//! System session and input-idle signals for auto-lock.
//!
//! The desktop vault should lock when the *user* leaves the machine, not when
//! the desktop window simply goes unused. These signals let the auto-lock loop
//! follow the interactive session: system-wide keyboard/mouse idle time and the
//! workstation lock screen.

/// Seconds since the last system-wide user input (keyboard or mouse).
///
/// Returns `None` where the platform can't report a reliable value.
pub fn system_idle_secs() -> Option<u64> {
    #[cfg(target_os = "windows")]
    {
        windows_idle_secs()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// Whether the interactive desktop is currently locked (lock screen / Win+L).
pub fn session_locked() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_session_locked()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[cfg(target_os = "windows")]
fn windows_idle_secs() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return None;
    }
    let now = unsafe { GetTickCount() };
    Some(u64::from(now.wrapping_sub(info.dwTime)) / 1000)
}

#[cfg(target_os = "windows")]
fn windows_session_locked() -> bool {
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP, OpenInputDesktop,
    };

    // When the workstation is locked, the secure Winlogon desktop owns input and
    // a normal process can no longer open the input desktop with switch access.
    unsafe {
        match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP) {
            Ok(desktop) => {
                let _ = CloseDesktop(desktop);
                false
            }
            Err(_) => true,
        }
    }
}
