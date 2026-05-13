using System;
using CTRL.Bindings;

namespace CTRL.Services;

internal static class KernelErrors
{
    public static string Format(Exception ex, string operation) => ex switch
    {
        KernelException kex => $"{operation} failed (code {kex.Code}): {kex.Message}",
        DllNotFoundException => "ctrl_lib.dll not found. Build the Rust core first: cd src-tauri && cargo build --release",
        _ => $"{operation} error ({ex.GetType().Name}): {ex.Message}",
    };
}
