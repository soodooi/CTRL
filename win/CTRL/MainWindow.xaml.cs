using Microsoft.UI.Xaml;

namespace CTRL;

/// <summary>
/// Hosts navigation Frame for app pages. Navigates to MainPage on startup.
/// Uses WinAppSDK 2.0 TitleBar custom control + Mica backdrop.
/// </summary>
public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);

        AppWindow.SetIcon("Assets/AppIcon.ico");

        RootFrame.Navigate(typeof(MainPage));
    }
}
