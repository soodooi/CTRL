using System;
using System.Runtime.InteropServices;

namespace CTRL.Services;

internal static class Win32
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr GetModuleHandleW(string? lpModuleName);

    public static void ThrowLast(string operation)
    {
        var err = Marshal.GetLastWin32Error();
        throw new InvalidOperationException($"{operation} failed (Win32 error {err}).");
    }
}
