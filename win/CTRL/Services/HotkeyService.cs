using System;
using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;

namespace CTRL.Services;

// Global single-Ctrl-tap detector. RegisterHotKey cannot bind a lone
// modifier, so we install a low-level keyboard hook. The callback runs
// in the OS message dispatch path for every keystroke system-wide and
// must return promptly (Microsoft guidance: <30ms or the OS unmaps the
// hook), so the hot path stays free of allocations and managed marshal.
public sealed class HotkeyService : IDisposable
{
    private const long ThresholdMs = 400;

    private readonly DispatcherQueue _dispatcher;
    // Keep a managed reference to the delegate so the GC does not collect
    // it while the OS still holds the native function pointer.
    private readonly HotkeyInterop.HookProc _callback;
    private IntPtr _hookHandle;

    private bool _ctrlPending;
    private bool _otherSeen;
    private long _ctrlDownTimeMs;

    /// <summary>
    /// Fires on the UI thread when a lone Ctrl tap is detected.
    /// </summary>
    public event EventHandler? HotkeyTriggered;

    public HotkeyService(DispatcherQueue dispatcher)
    {
        _dispatcher = dispatcher;
        _callback = HookCallback;

        var moduleHandle = Win32.GetModuleHandleW(null);
        _hookHandle = HotkeyInterop.SetWindowsHookExW(
            HotkeyInterop.WH_KEYBOARD_LL, _callback, moduleHandle, 0);

        if (_hookHandle == IntPtr.Zero) Win32.ThrowLast("Install low-level keyboard hook");
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode != HotkeyInterop.HC_ACTION)
            return HotkeyInterop.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);

        int msg = wParam.ToInt32();
        bool isKeyDown = msg == HotkeyInterop.WM_KEYDOWN || msg == HotkeyInterop.WM_SYSKEYDOWN;
        bool isKeyUp = msg == HotkeyInterop.WM_KEYUP || msg == HotkeyInterop.WM_SYSKEYUP;
        if (!isKeyDown && !isKeyUp)
            return HotkeyInterop.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);

        // VkCode is the first DWORD of KBDLLHOOKSTRUCT — read directly to
        // skip a full struct marshal on every keystroke.
        uint vk = unchecked((uint)Marshal.ReadInt32(lParam));
        bool isCtrl = vk == HotkeyInterop.VK_LCONTROL || vk == HotkeyInterop.VK_RCONTROL;

        if (isCtrl && isKeyDown && !_ctrlPending)
        {
            if (!IsAnyOtherModifierDown())
            {
                _ctrlPending = true;
                _otherSeen = false;
                _ctrlDownTimeMs = Environment.TickCount64;
            }
        }
        else if (isCtrl && isKeyUp && _ctrlPending)
        {
            var elapsed = Environment.TickCount64 - _ctrlDownTimeMs;
            if (!_otherSeen && elapsed < ThresholdMs)
            {
                _dispatcher.TryEnqueue(() =>
                    HotkeyTriggered?.Invoke(this, EventArgs.Empty));
            }
            _ctrlPending = false;
            _otherSeen = false;
        }
        else if (isKeyDown && _ctrlPending && !isCtrl)
        {
            _otherSeen = true;
        }

        return HotkeyInterop.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static bool IsAnyOtherModifierDown()
    {
        return IsKeyDown(HotkeyInterop.VK_SHIFT)
            || IsKeyDown(HotkeyInterop.VK_MENU)
            || IsKeyDown(HotkeyInterop.VK_LWIN)
            || IsKeyDown(HotkeyInterop.VK_RWIN);
    }

    private static bool IsKeyDown(int vk)
    {
        return (HotkeyInterop.GetAsyncKeyState(vk) & 0x8000) != 0;
    }

    public void Dispose()
    {
        if (_hookHandle != IntPtr.Zero)
        {
            HotkeyInterop.UnhookWindowsHookEx(_hookHandle);
            _hookHandle = IntPtr.Zero;
        }
    }
}
