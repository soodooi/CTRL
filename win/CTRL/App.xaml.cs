using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using CTRL.Bindings;
using CTRL.Services;
using Microsoft.UI.Xaml;

namespace CTRL;

/// <summary>
/// CTRL application entry point. Kicks off Rust kernel auto-boot in background
/// before activating the main window so the UI never blocks on FFI work.
/// Installs the global Ctrl-tap hotkey listener after the window is up.
/// </summary>
public partial class App : Application
{
    private Window? _window;
    private HotkeyService? _hotkey;

    /// <summary>
    /// Local data directory passed to the Rust kernel on boot. SQLite event
    /// store, manifest cache, and AI memory live here.
    /// </summary>
    public static string KernelDataDir { get; private set; } = string.Empty;

    /// <summary>
    /// Background kernel-boot task. Result is null on success or a
    /// user-readable error message on failure.
    /// </summary>
    public static Task<string?> BootTask { get; private set; } =
        Task.FromResult<string?>(null);

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        KernelDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ctrl");
        Directory.CreateDirectory(KernelDataDir);

        BootTask = Task.Run<string?>(BootKernel);

        _window = new MainWindow();
        _window.Activate();

        InstallHotkey();
    }

    private void InstallHotkey()
    {
        try
        {
            _hotkey = new HotkeyService(_window!.DispatcherQueue);
            _hotkey.HotkeyTriggered += OnHotkeyTriggered;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[HOTKEY] install failed: {ex.Message}");
        }
    }

    private static void OnHotkeyTriggered(object? sender, EventArgs e)
    {
        // W3.2 stub: log only. Window show/hide wiring lands in W3.5.
        Debug.WriteLine($"[HOTKEY] {DateTime.Now:HH:mm:ss.fff} Ctrl tap detected");
    }

    private static string? BootKernel()
    {
        try
        {
            Kernel.Boot(KernelDataDir);
            return null;
        }
        catch (KernelException kex)
        {
            return $"Kernel boot failed (code {kex.Code}): {kex.Message}";
        }
        catch (DllNotFoundException)
        {
            return
                "ctrl_lib.dll not found. Build the Rust core first:\n" +
                "  cd src-tauri\n" +
                "  cargo build --release";
        }
        catch (Exception ex)
        {
            return $"Unexpected boot error ({ex.GetType().Name}): {ex.Message}";
        }
    }
}
