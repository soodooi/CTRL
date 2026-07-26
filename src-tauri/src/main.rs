#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if ctrl_lib::run_updater_helper_from_args() {
        return;
    }
    ctrl_lib::run();
}
