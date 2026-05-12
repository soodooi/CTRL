using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace CTRL;

/// <summary>
/// Transitional kernel-boot status page (W3.1). Awaits the background boot
/// task started by <see cref="App.BootTask"/> and renders success or error
/// detail. Replaced by KeycapPoolPage in W3.4 when the launcher UX lands.
/// </summary>
public sealed partial class MainPage : Page
{
    public MainPage()
    {
        InitializeComponent();
    }

    private async void Page_Loaded(object sender, RoutedEventArgs e)
    {
        var error = await App.BootTask;
        StatusText.Text = error is null
            ? $"Kernel booted.\nData dir: {App.KernelDataDir}"
            : error;
    }
}
