using System;
using System.Diagnostics;
using CTRL.Models;
using CTRL.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace CTRL;

/// <summary>
/// Ephemeral workspace surface: hosts the running tool for a single keycap.
/// Navigated to from KeycapPoolPage with a <see cref="Keycap"/> parameter.
/// Currently renders the demo echo response as plain text; the Frame
/// renderer (text / form / choices / widget / file streams per
/// doc/brainstorm-strategy-2026-05-05.md §4.7) lands once tool manifests
/// drive the workspace shape.
/// </summary>
public sealed partial class WorkspacePage : Page
{
    public WorkspacePage()
    {
        InitializeComponent();
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);

        if (e.Parameter is not Keycap keycap)
        {
            BodyText.Text = "No keycap selected.";
            return;
        }

        IconText.Text = keycap.Icon;
        NameText.Text = keycap.Name;
        BodyText.Text = "Running ...";

        try
        {
            BodyText.Text = await KeycapInvoker.RunEcho(keycap.Id);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WORKSPACE] {keycap.Id} crashed: {ex}");
            BodyText.Text = $"Unexpected ({ex.GetType().Name}):\n{ex.Message}";
        }
    }

    private void BackButton_Click(object sender, RoutedEventArgs e)
    {
        if (Frame.CanGoBack) Frame.GoBack();
    }
}
