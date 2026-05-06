// Pure state machine for single-Ctrl detection. No OS calls — shared across platforms.

pub const SINGLE_CTRL_MAX_DURATION_MS: u64 = 250;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectionState {
    Idle,
    Armed,
    Disarmed,
    Triggered,
}

#[derive(Debug)]
pub struct SingleCtrlDetector {
    max_duration_ms: u64,
    armed_at: Option<u64>,
    disarmed: bool,
}

impl SingleCtrlDetector {
    pub fn new(max_duration_ms: u64) -> Self {
        Self {
            max_duration_ms,
            armed_at: None,
            disarmed: false,
        }
    }

    pub fn on_ctrl_down(&mut self, t_ms: u64) -> DetectionState {
        if self.armed_at.is_none() {
            self.armed_at = Some(t_ms);
            self.disarmed = false;
            DetectionState::Armed
        } else if self.disarmed {
            DetectionState::Disarmed
        } else {
            DetectionState::Armed
        }
    }

    pub fn on_ctrl_up(&mut self, t_ms: u64) -> DetectionState {
        let armed = self.armed_at.take();
        let was_disarmed = self.disarmed;
        self.disarmed = false;

        match armed {
            Some(t0) if !was_disarmed && t_ms.saturating_sub(t0) <= self.max_duration_ms => {
                DetectionState::Triggered
            }
            _ => DetectionState::Idle,
        }
    }

    pub fn on_other_key_down(&mut self, _t_ms: u64) -> DetectionState {
        if self.armed_at.is_some() {
            self.disarmed = true;
            DetectionState::Disarmed
        } else {
            DetectionState::Idle
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_press_within_window_triggers() {
        let mut d = SingleCtrlDetector::new(250);
        assert_eq!(d.on_ctrl_down(0), DetectionState::Armed);
        assert_eq!(d.on_ctrl_up(100), DetectionState::Triggered);
    }

    #[test]
    fn press_exceeds_window_does_not_trigger() {
        let mut d = SingleCtrlDetector::new(250);
        d.on_ctrl_down(0);
        assert_eq!(d.on_ctrl_up(300), DetectionState::Idle);
    }

    #[test]
    fn other_key_during_press_disarms_and_release_yields_idle() {
        let mut d = SingleCtrlDetector::new(250);
        d.on_ctrl_down(0);
        assert_eq!(d.on_other_key_down(50), DetectionState::Disarmed);
        assert_eq!(d.on_ctrl_up(100), DetectionState::Idle);
    }

    #[test]
    fn back_to_back_clicks_each_trigger() {
        let mut d = SingleCtrlDetector::new(250);
        d.on_ctrl_down(0);
        assert_eq!(d.on_ctrl_up(100), DetectionState::Triggered);
        d.on_ctrl_down(200);
        assert_eq!(d.on_ctrl_up(300), DetectionState::Triggered);
    }

    #[test]
    fn ctrl_repeat_does_not_reset_arm_timestamp() {
        let mut d = SingleCtrlDetector::new(250);
        assert_eq!(d.on_ctrl_down(0), DetectionState::Armed);
        // Second down without an up — key autorepeat. Must not refresh armed_at.
        assert_eq!(d.on_ctrl_down(200), DetectionState::Armed);
        // Total elapsed since first arm = 240ms, still ≤ 250 → Triggered.
        assert_eq!(d.on_ctrl_up(240), DetectionState::Triggered);
    }
}
