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
/// Wires the global Ctrl-tap hotkey, the system tray icon, and the focus-loss
/// auto-hide so the window behaves like an ambient launcher.
/// </summary>
public partial class App : Application
{
    private Window? _window;
    private HotkeyService? _hotkey;
    private TrayService? _tray;

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

    /// <summary>
    /// Background readiness task: BootTask + demo MCP server register/connect.
    /// Resolves to null when keycap click can safely route through Mcp.Invoke,
    /// otherwise to a user-readable failure reason. Hard-coded to register
    /// @modelcontextprotocol/server-everything for the W3.6 walkthrough; real
    /// MCP server config moves into SettingsPage once that UI lands.
    /// </summary>
    public static Task<string?> ReadyTask { get; private set; } =
        Task.FromResult<string?>(null);

    /// <summary>
    /// MCP server id used for the W3.6 demo wiring. Keycap clicks invoke
    /// the `echo` tool on this server.
    /// </summary>
    public const string DemoMcpServerId = "everything";

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
        ReadyTask = SetupAfterBoot();

        _window = new MainWindow();
        _window.Activated += OnWindowActivated;
        _window.Activate();

        InstallHotkey();
        InstallTray();
    }

    private void InstallHotkey()
    {
        try
        {
            _hotkey = new HotkeyService(_window!.DispatcherQueue);
            _hotkey.HotkeyTriggered += (_, _) => ToggleWindow();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[HOTKEY] install failed: {ex.Message}");
        }
    }

    private void InstallTray()
    {
        try
        {
            var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico");
            _tray = new TrayService(_window!.DispatcherQueue, iconPath);
            _tray.ShowToggleRequested += (_, _) => ToggleWindow();
            _tray.SettingsRequested += (_, _) =>
            {
                // W3.5 stub: SettingsPage navigation lands in W3.6.
                Debug.WriteLine("[TRAY] settings requested");
            };
            _tray.ExitRequested += (_, _) => Exit();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[TRAY] install failed: {ex.Message}");
        }
    }

    private void OnWindowActivated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState != WindowActivationState.Deactivated) return;
        // Keep the window visible while a debugger is attached so dev cycles
        // are not interrupted by focus-loss auto-hide.
        if (Debugger.IsAttached) return;
        _window?.AppWindow.Hide();
    }

    private void ToggleWindow()
    {
        if (_window is null) return;
        if (_window.AppWindow.IsVisible)
        {
            _window.AppWindow.Hide();
        }
        else
        {
            _window.AppWindow.Show();
            _window.Activate();
        }
    }

    private static async Task<string?> SetupAfterBoot()
    {
        var bootErr = await BootTask;
        if (bootErr is not null) return bootErr;
        return await Task.Run(SetupDemoMcp);
    }

    private static string? SetupDemoMcp()
    {
        try
        {
            // Anthropic reference MCP server. Run via `npx -y` per the Npm
            // source variant in src-tauri/src/kernel/mcp_host.rs. First call
            // downloads the package; subsequent calls reuse the npm cache.
            const string descriptorJson = """
            {
              "id": "everything",
              "name": "MCP Everything (demo)",
              "version": "1.0",
              "description": "Anthropic reference MCP server for end-to-end testing",
              "tools": [],
              "source": {
                "kind": "npm",
                "package": "@modelcontextprotocol/server-everything",
                "args": []
              }
            }
            """;
            Mcp.Register(descriptorJson);
            Mcp.Connect(DemoMcpServerId);
            return null;
        }
        catch (KernelException kex)
        {
            return $"MCP setup failed (code {kex.Code}): {kex.Message}";
        }
        catch (DllNotFoundException)
        {
            // BootKernel already covered this; included for completeness.
            return "ctrl_lib.dll not found.";
        }
        catch (Exception ex)
        {
            return $"MCP setup error ({ex.GetType().Name}): {ex.Message}";
        }
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
