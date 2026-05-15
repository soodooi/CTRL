use std::env;
use std::path::PathBuf;

fn main() {
    // 1. UniFFI scaffolding from src/ctrl.udl (Swift / Kotlin bindings).
    uniffi::generate_scaffolding("src/ctrl.udl").expect("UniFFI scaffolding failed");

    // 2. cbindgen C header from src/ffi/native.rs (C / C++ P/Invoke).
    // Pre-PWA pivot this wrote into win/CTRL/Bindings/ for the WinUI 3 C# host.
    // ADR-002 retired that consumer; we now emit into the build's target dir
    // so the artifact stops polluting the source tree. The whole cbindgen +
    // ffi/native.rs path is on the chopping block in H-2026-05-14-002 mac/c.
    let crate_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let out_header = PathBuf::from(env::var("OUT_DIR").unwrap_or_else(|_| crate_dir.clone()))
        .join("cbindgen")
        .join("ctrl_native.h");

    if let Some(parent) = out_header.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let config_path = PathBuf::from(&crate_dir).join("cbindgen.toml");
    let config = cbindgen::Config::from_file(&config_path)
        .expect("cbindgen.toml not found or invalid");

    match cbindgen::Builder::new()
        .with_crate(&crate_dir)
        .with_config(config)
        .generate()
    {
        Ok(bindings) => {
            bindings.write_to_file(&out_header);
            println!("cargo:warning=cbindgen wrote {}", out_header.display());
        }
        Err(e) => {
            // Don't fail the build — cbindgen errors typically come from in-progress
            // refactors; surface as warning so cargo check keeps moving.
            println!("cargo:warning=cbindgen generation failed: {e}");
        }
    }

    // 3. Tauri build (legacy shell, transitional).
    tauri_build::build();
}
