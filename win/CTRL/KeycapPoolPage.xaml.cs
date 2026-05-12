using System.Collections.Generic;
using System.Linq;
using CTRL.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace CTRL;

/// <summary>
/// Launcher grid showing the v1 keycap pool. Clicking a keycap navigates
/// the host Frame to WorkspacePage, which runs the tool and renders the
/// result inline. Tool invocation lives in <see cref="Services.KeycapInvoker"/>
/// so the page itself stays UI-only.
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
        if (sender is not Button { Tag: string id }) return;
        var keycap = Keycaps.FirstOrDefault(k => k.Id == id);
        if (keycap is null) return;
        Frame.Navigate(typeof(WorkspacePage), keycap);
    }
}
