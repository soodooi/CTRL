// SPDX-License-Identifier: All-Rights-Reserved
//
// Hand-rolled tray icon service:
//   1. Registers a window class + creates a message-only HWND so the icon
//      has somewhere to deliver mouse-event callbacks.
//   2. Loads an icon from disk and registers it with Shell_NotifyIcon.
//   3. Left-click / double-click   -> ShowToggleRequested event
//      Right-click                 -> Win32 popup menu
//      Menu items                  -> ShowToggleRequested / SettingsRequested
//                                     / ExitRequested events
//   4. Releases all native resources on Dispose.
//
// All events fire on the UI thread via DispatcherQueue, since the window
// proc runs in the kernel-driven dispatch path.

using System;
using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;

namespace CTRL.Services;

public sealed class TrayService : IDisposable
{
    private const string ClassName = "CtrlTrayMessageOnly";
    private const string Tooltip = "CTRL";
    private const uint TrayIconId = 1;

    private enum MenuItem : uint
    {
        Show = 1,
        Settings = 2,
        Exit = 3,
    }

    private readonly DispatcherQueue _dispatcher;
    // Keep a managed reference so the GC does not collect the delegate
    // while Windows still holds the function pointer.
    private readonly TrayInterop.WndProcDelegate _wndProc;
    private readonly IntPtr _moduleHandle;

    private IntPtr _hwnd;
    private IntPtr _hIcon;
    private bool _classRegistered;
    private bool _iconAdded;

    /// <summary>Raised when the user left-clicks the tray icon or chooses Show.</summary>
    public event EventHandler? ShowToggleRequested;
    /// <summary>Raised when the user picks Settings from the tray menu.</summary>
    public event EventHandler? SettingsRequested;
    /// <summary>Raised when the user picks Exit from the tray menu.</summary>
    public event EventHandler? ExitRequested;

    public TrayService(DispatcherQueue dispatcher, string iconPath)
    {
        _dispatcher = dispatcher;
        _wndProc = WindowProc;
        _moduleHandle = TrayInterop.GetModuleHandleW(null);

        RegisterWindowClass();
        CreateMessageWindow();
        LoadIcon(iconPath);
        AddTrayIcon();
    }

    private void RegisterWindowClass()
    {
        var wc = new TrayInterop.WNDCLASSEXW
        {
            cbSize = (uint)Marshal.SizeOf<TrayInterop.WNDCLASSEXW>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProc),
            hInstance = _moduleHandle,
            lpszClassName = ClassName,
        };

        if (TrayInterop.RegisterClassExW(ref wc) == 0)
        {
            var err = Marshal.GetLastWin32Error();
            if (err != TrayInterop.ERROR_CLASS_ALREADY_EXISTS)
            {
                throw new InvalidOperationException(
                    $"Tray window class registration failed (Win32 error {err}).");
            }
        }
        _classRegistered = true;
    }

    private void CreateMessageWindow()
    {
        _hwnd = TrayInterop.CreateWindowExW(
            0, ClassName, null, 0,
            0, 0, 0, 0,
            new IntPtr(TrayInterop.HWND_MESSAGE), IntPtr.Zero,
            _moduleHandle, IntPtr.Zero);

        if (_hwnd == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                $"Tray message window creation failed (Win32 error {Marshal.GetLastWin32Error()}).");
        }
    }

    private void LoadIcon(string iconPath)
    {
        _hIcon = TrayInterop.LoadImageW(
            IntPtr.Zero, iconPath, TrayInterop.IMAGE_ICON,
            0, 0, TrayInterop.LR_LOADFROMFILE | TrayInterop.LR_DEFAULTSIZE);

        if (_hIcon == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                $"Tray icon load failed for '{iconPath}' (Win32 error {Marshal.GetLastWin32Error()}).");
        }
    }

    private void AddTrayIcon()
    {
        var data = new TrayInterop.NOTIFYICONDATAW
        {
            cbSize = (uint)Marshal.SizeOf<TrayInterop.NOTIFYICONDATAW>(),
            hWnd = _hwnd,
            uID = TrayIconId,
            uFlags = TrayInterop.NIF_MESSAGE | TrayInterop.NIF_ICON | TrayInterop.NIF_TIP,
            uCallbackMessage = TrayInterop.WM_TRAYICON,
            hIcon = _hIcon,
            szTip = Tooltip,
        };

        if (!TrayInterop.Shell_NotifyIconW(TrayInterop.NIM_ADD, ref data))
        {
            throw new InvalidOperationException(
                $"Shell_NotifyIcon NIM_ADD failed (Win32 error {Marshal.GetLastWin32Error()}).");
        }
        _iconAdded = true;
    }

    private IntPtr WindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == TrayInterop.WM_TRAYICON)
        {
            var mouseMsg = (uint)(lParam.ToInt64() & 0xFFFF);
            switch (mouseMsg)
            {
                case TrayInterop.WM_LBUTTONUP:
                case TrayInterop.WM_LBUTTONDBLCLK:
                    _dispatcher.TryEnqueue(() =>
                        ShowToggleRequested?.Invoke(this, EventArgs.Empty));
                    return IntPtr.Zero;
                case TrayInterop.WM_RBUTTONUP:
                    ShowContextMenu();
                    return IntPtr.Zero;
            }
        }

        return TrayInterop.DefWindowProcW(hWnd, msg, wParam, lParam);
    }

    private void ShowContextMenu()
    {
        var menu = TrayInterop.CreatePopupMenu();
        if (menu == IntPtr.Zero) return;

        try
        {
            TrayInterop.AppendMenuW(menu, TrayInterop.MF_STRING,
                new UIntPtr((uint)MenuItem.Show), "Show CTRL");
            TrayInterop.AppendMenuW(menu, TrayInterop.MF_STRING,
                new UIntPtr((uint)MenuItem.Settings), "Settings...");
            TrayInterop.AppendMenuW(menu, TrayInterop.MF_SEPARATOR,
                UIntPtr.Zero, null);
            TrayInterop.AppendMenuW(menu, TrayInterop.MF_STRING,
                new UIntPtr((uint)MenuItem.Exit), "Exit");

            TrayInterop.GetCursorPos(out var pt);
            // Required by Win32 contract so the menu dismisses on outside click.
            TrayInterop.SetForegroundWindow(_hwnd);

            var selected = TrayInterop.TrackPopupMenuEx(
                menu,
                TrayInterop.TPM_RIGHTBUTTON | TrayInterop.TPM_RETURNCMD | TrayInterop.TPM_NONOTIFY,
                pt.X, pt.Y, _hwnd, IntPtr.Zero);

            if (selected != 0)
            {
                _dispatcher.TryEnqueue(() => RaiseMenuEvent((MenuItem)selected));
            }
        }
        finally
        {
            TrayInterop.DestroyMenu(menu);
        }
    }

    private void RaiseMenuEvent(MenuItem item)
    {
        switch (item)
        {
            case MenuItem.Show:
                ShowToggleRequested?.Invoke(this, EventArgs.Empty);
                break;
            case MenuItem.Settings:
                SettingsRequested?.Invoke(this, EventArgs.Empty);
                break;
            case MenuItem.Exit:
                ExitRequested?.Invoke(this, EventArgs.Empty);
                break;
        }
    }

    public void Dispose()
    {
        if (_iconAdded && _hwnd != IntPtr.Zero)
        {
            var data = new TrayInterop.NOTIFYICONDATAW
            {
                cbSize = (uint)Marshal.SizeOf<TrayInterop.NOTIFYICONDATAW>(),
                hWnd = _hwnd,
                uID = TrayIconId,
            };
            TrayInterop.Shell_NotifyIconW(TrayInterop.NIM_DELETE, ref data);
            _iconAdded = false;
        }

        if (_hIcon != IntPtr.Zero)
        {
            TrayInterop.DestroyIcon(_hIcon);
            _hIcon = IntPtr.Zero;
        }

        if (_hwnd != IntPtr.Zero)
        {
            TrayInterop.DestroyWindow(_hwnd);
            _hwnd = IntPtr.Zero;
        }

        if (_classRegistered)
        {
            TrayInterop.UnregisterClassW(ClassName, _moduleHandle);
            _classRegistered = false;
        }
    }
}
