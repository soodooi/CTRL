// SPDX-License-Identifier: All-Rights-Reserved
//
// Global single-Ctrl-tap detector. Required since RegisterHotKey cannot
// bind a lone modifier — we install a low-level keyboard hook and run
// the detection state machine ourselves.
//
// State machine:
//   Ctrl KEYDOWN (no other modifier already down)  -> arm pending, record T0
//   any non-Ctrl KEYDOWN while pending             -> mark otherSeen
//   Ctrl KEYUP                                     -> if pending && !otherSeen
//                                                       && elapsed < ThresholdMs
//                                                      -> raise HotkeyTriggered
//
// HotkeyTriggered is dispatched onto the UI thread via DispatcherQueue,
// since the hook callback runs in the OS message dispatch path and must
// return immediately.

using System;
using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;

namespace CTRL.Services;

public sealed class HotkeyService : IDisposable
{
    private const long ThresholdMs = 400;

    private readonly DispatcherQueue _dispatcher;
    // Keep a managed reference to the callback so the GC does not collect
    // it while the OS still holds the native function pointer.
    private readonly HotkeyInterop.HookProc _callback;
    private IntPtr _hookHandle;

    private bool _ctrlPending;
    private bool _otherSeen;
    private long _ctrlDownTimeMs;

    /// <summary>
    /// Fires on the UI thread when a lone Ctrl tap is detected (key down,
    /// no other key pressed, key up within ThresholdMs).
    /// </summary>
    public event EventHandler? HotkeyTriggered;

    public HotkeyService(DispatcherQueue dispatcher)
    {
        _dispatcher = dispatcher;
        _callback = HookCallback;

        var moduleHandle = HotkeyInterop.GetModuleHandleW(null);
        _hookHandle = HotkeyInterop.SetWindowsHookExW(
            HotkeyInterop.WH_KEYBOARD_LL, _callback, moduleHandle, 0);

        if (_hookHandle == IntPtr.Zero)
        {
            var err = Marshal.GetLastWin32Error();
            throw new InvalidOperationException(
                $"Failed to install low-level keyboard hook (Win32 error {err}).");
        }
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HotkeyInterop.HC_ACTION)
        {
            var data = Marshal.PtrToStructure<HotkeyInterop.KBDLLHOOKSTRUCT>(lParam);
            int msg = wParam.ToInt32();
            uint vk = data.VkCode;

            bool isCtrl = vk == HotkeyInterop.VK_LCONTROL || vk == HotkeyInterop.VK_RCONTROL;
            bool isKeyDown = msg == HotkeyInterop.WM_KEYDOWN || msg == HotkeyInterop.WM_SYSKEYDOWN;
            bool isKeyUp = msg == HotkeyInterop.WM_KEYUP || msg == HotkeyInterop.WM_SYSKEYUP;

            if (isCtrl && isKeyDown && !_ctrlPending)
            {
                // Don't arm if user is starting a chord that already has
                // another modifier held (e.g. Alt+Ctrl).
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
