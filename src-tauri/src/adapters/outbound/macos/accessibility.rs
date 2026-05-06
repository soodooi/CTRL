// macOS adapter implementing AccessibilityPort via AXIsProcessTrustedWithOptions.

use crate::application::ports::AccessibilityPort;

pub struct MacAccessibility;

impl MacAccessibility {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MacAccessibility {
    fn default() -> Self {
        Self::new()
    }
}

impl AccessibilityPort for MacAccessibility {
    fn is_trusted(&self) -> bool {
        macos_accessibility_client::accessibility::application_is_trusted()
    }

    fn request_with_prompt(&self) -> bool {
        macos_accessibility_client::accessibility::application_is_trusted_with_prompt()
    }

    fn open_settings(&self) {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }
}
