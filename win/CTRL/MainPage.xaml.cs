using System;
using System.IO;
using System.Threading.Tasks;
using CTRL.Bindings;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace CTRL;

/// <summary>
/// W2 smoke test page — boots the Rust kernel via P/Invoke and displays
/// the health snapshot. Validates the cdylib + cbindgen + LibraryImport
/// pipeline end-to-end.
/// </summary>
public sealed partial class MainPage : Page
{
    public MainPage()
    {
        InitializeComponent();
    }

    private async void BootButton_Click(object sender, RoutedEventArgs e)
    {
        BootButton.IsEnabled = false;
        OutputText.Text = "Booting Rust kernel ...";

        try
        {
            // Resolve LocalAppData/ctrl as the kernel data dir (event store DB lives here).
            var dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ctrl");
            Directory.CreateDirectory(dataDir);

            await Task.Run(() => Kernel.Boot(dataDir));

            OutputText.Text = $"Kernel booted at:\n{dataDir}\n\nClick 'Kernel Health' to verify.";
            HealthButton.IsEnabled = true;
        }
        catch (KernelException kex)
        {
            OutputText.Text = $"Kernel boot failed (code {kex.Code}):\n{kex.Message}";
            BootButton.IsEnabled = true;
        }
        catch (DllNotFoundException)
        {
            OutputText.Text =
                "ctrl_lib.dll not found.\n\n" +
                "Build the Rust core first:\n" +
                "  cd src-tauri\n" +
                "  cargo build --release\n" +
                "Then copy target/release/ctrl_lib.dll into the WinUI output dir.";
            BootButton.IsEnabled = true;
        }
        catch (Exception ex)
        {
            OutputText.Text = $"Unexpected error: {ex.GetType().Name}\n{ex.Message}";
            BootButton.IsEnabled = true;
        }
    }

    private async void HealthButton_Click(object sender, RoutedEventArgs e)
    {
        HealthButton.IsEnabled = false;
        OutputText.Text = "Querying kernel health ...";

        try
        {
            var json = await Task.Run(() => Kernel.Health());
            OutputText.Text = "Health snapshot:\n\n" + json;
        }
        catch (KernelException kex)
        {
            OutputText.Text = $"Health query failed (code {kex.Code}):\n{kex.Message}";
        }
        finally
        {
            HealthButton.IsEnabled = true;
        }
    }
}
