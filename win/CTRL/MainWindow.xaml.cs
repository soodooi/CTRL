using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace CTRL;

/// <summary>
/// Frameless always-on-top launcher window. Mica backdrop, no border, no
/// title bar, no min/max/resize. Hosts the navigation Frame; KeycapPool
/// replaces MainPage as the default landing page in W3.4.
/// </summary>
public sealed partial class MainWindow : Window
{
    private const int InitialWidth = 720;
    private const int InitialHeight = 480;

    public MainWindow()
    {
        InitializeComponent();

        ConfigurePresenter();
        ResizeAndCenter();
        AppWindow.SetIcon("Assets/AppIcon.ico");

        RootFrame.Navigate(typeof(MainPage));
    }

    private void ConfigurePresenter()
    {
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.SetBorderAndTitleBar(hasBorder: false, hasTitleBar: false);
            presenter.IsAlwaysOnTop = true;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
            presenter.IsResizable = false;
        }
    }

    private void ResizeAndCenter()
    {
        AppWindow.Resize(new SizeInt32(InitialWidth, InitialHeight));

        var displayArea = DisplayArea.GetFromWindowId(
            AppWindow.Id, DisplayAreaFallback.Primary);
        var work = displayArea.WorkArea;
        var x = work.X + (work.Width - InitialWidth) / 2;
        var y = work.Y + (work.Height - InitialHeight) / 2;
        AppWindow.Move(new PointInt32(x, y));
    }
}
