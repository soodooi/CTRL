using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using CTRL.Bindings;
using CTRL.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace CTRL;

/// <summary>
/// Launcher grid showing the v1 keycap pool. W3.6 wiring: clicking a keycap
/// routes through Mcp.Invoke against the demo MCP server (echo tool) and
/// shows the response in a ContentDialog. Real per-keycap manifests + tool
/// dispatch land once the manifest schema is implemented end-to-end.
/// </summary>
public sealed partial class KeycapPoolPage : Page
{
    public IReadOnlyList<Keycap> Keycaps { get; } = BuiltinKeycaps.All;

    public KeycapPoolPage()
    {
        InitializeComponent();
    }

    private async void KeycapButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string id }) return;

        var text = await InvokeEcho(id);
        await ShowResultDialog(id, text);
    }

    private static async Task<string> InvokeEcho(string keycapId)
    {
        var setupErr = await App.ReadyTask;
        if (setupErr is not null) return $"Kernel / MCP not ready:\n\n{setupErr}";

        try
        {
            var argsJson = JsonSerializer.Serialize(new { message = $"hello from keycap '{keycapId}'" });
            var result = await Task.Run(() =>
                Mcp.Invoke(App.DemoMcpServerId, "echo", argsJson));
            return result;
        }
        catch (KernelException kex)
        {
            return $"MCP invoke failed (code {kex.Code}):\n{kex.Message}";
        }
        catch (Exception ex)
        {
            return $"Unexpected ({ex.GetType().Name}):\n{ex.Message}";
        }
    }

    private async Task ShowResultDialog(string keycapId, string body)
    {
        var dialog = new ContentDialog
        {
            Title = $"echo({keycapId})",
            Content = new TextBlock
            {
                Text = body,
                TextWrapping = TextWrapping.Wrap,
                IsTextSelectionEnabled = true,
                FontFamily = new Microsoft.UI.Xaml.Media.FontFamily("Consolas, 'JetBrains Mono', monospace"),
                FontSize = 12,
            },
            CloseButtonText = "Close",
            XamlRoot = XamlRoot,
        };
        await dialog.ShowAsync();
    }
}
