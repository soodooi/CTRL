// Cross-platform clock adapter using std::time::Instant.

use std::time::Instant;

use crate::application::ports::ClockPort;

pub struct InstantClock {
    started: Instant,
}

impl InstantClock {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}

impl Default for InstantClock {
    fn default() -> Self {
        Self::new()
    }
}

impl ClockPort for InstantClock {
    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
}
