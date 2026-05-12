fn main() {
    // Generate UniFFI scaffolding from src/ffi/ctrl.udl before tauri-build runs.
    // This produces the FFI scaffolding compiled into the cdylib.
    uniffi::generate_scaffolding("src/ctrl.udl").expect("UniFFI scaffolding failed");
    tauri_build::build();
}
