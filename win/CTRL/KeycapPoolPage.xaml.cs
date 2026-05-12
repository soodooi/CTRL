using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using CTRL.Bindings;
using CTRL.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

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
        try
        {
            if (sender is not Button { Tag: string id }) return;

            var text = await InvokeEcho(id);
            await ShowResultDialog(id, text);
        }
        catch (Exception ex)
        {
            // Last-resort guard: an unhandled exception inside an async void
            // handler crashes the XAML root with 0xc000027b. Log and swallow.
            Debug.WriteLine($"[KEYCAP] click handler crashed: {ex}");
        }
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
            return string.IsNullOrEmpty(result) ? "(empty response)" : ExtractText(result);
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

    /// <summary>
    /// Unwrap the MCP CallToolResult envelope and concatenate any text-typed
    /// content blocks. Falls back to the raw JSON if the shape is anything
    /// else (image / binary / error variants for now).
    /// </summary>
    private static string ExtractText(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("content", out var content)
                || content.ValueKind != JsonValueKind.Array)
            {
                return raw;
            }

            var sb = new StringBuilder();
            foreach (var item in content.EnumerateArray())
            {
                if (item.TryGetProperty("type", out var type)
                    && type.GetString() == "text"
                    && item.TryGetProperty("text", out var text))
                {
                    if (sb.Length > 0) sb.AppendLine();
                    sb.Append(text.GetString());
                }
            }
            return sb.Length > 0 ? sb.ToString() : raw;
        }
        catch (JsonException)
        {
            return raw;
        }
    }

    private async Task ShowResultDialog(string keycapId, string body)
    {
        var root = XamlRoot;
        if (root is null)
        {
            Debug.WriteLine($"[KEYCAP] no XamlRoot for {keycapId}; body=\n{body}");
            return;
        }

        var dialog = new ContentDialog
        {
            Title = $"echo({keycapId})",
            Content = new TextBlock
            {
                Text = body,
                TextWrapping = TextWrapping.Wrap,
                IsTextSelectionEnabled = true,
                FontFamily = new FontFamily("Consolas"),
                FontSize = 12,
            },
            CloseButtonText = "Close",
            XamlRoot = root,
        };

        App.IsModalShowing = true;
        try
        {
            await dialog.ShowAsync();
        }
        finally
        {
            App.IsModalShowing = false;
        }
    }
}
