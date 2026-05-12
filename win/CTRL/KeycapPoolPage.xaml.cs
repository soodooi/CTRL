using System.Collections.Generic;
using System.Diagnostics;
using CTRL.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace CTRL;

/// <summary>
/// Launcher grid showing the v1 keycap pool. W3.4 stub — clicking a keycap
/// only logs. Real MCP invocation wiring lands in W3.7.
/// </summary>
public sealed partial class KeycapPoolPage : Page
{
    public IReadOnlyList<Keycap> Keycaps { get; } = BuiltinKeycaps.All;

    public KeycapPoolPage()
    {
        InitializeComponent();
    }

    private void KeycapButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string id })
        {
            Debug.WriteLine($"[KEYCAP] {id} clicked");
        }
    }
}
