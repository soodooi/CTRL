// SPDX-License-Identifier: All-Rights-Reserved
//
// Raw P/Invoke layer to ctrl_lib.dll (Rust core).
// Mirrors C ABI declared in ctrl_native.h (cbindgen-generated from
// src-tauri/src/ffi/native.rs).
//
// All return codes:
//    0  = success
//   -1  = null pointer / invalid input
//   -2  = UTF-8 decode failure
//   -3  = kernel error (call ErrorGetLast for message)
//   -99 = unexpected internal
//
// Strings:
//   * IN  — caller retains ownership; pass UTF-8 NUL-terminated bytes
//   * OUT — Rust heap-allocates; caller MUST call StringFree once consumed
//
// LibraryImport (.NET 7+) is preferred over DllImport for source-generated
// marshalling that avoids reflection at runtime.

using System;
using System.Runtime.InteropServices;

namespace CTRL.Bindings;

internal static partial class CtrlNative
{
    private const string Dll = "ctrl_lib";

    // ---- Error handling ----
    [LibraryImport(Dll, EntryPoint = "ctrl_native_error_get_last")]
    public static partial IntPtr ErrorGetLast();

    [LibraryImport(Dll, EntryPoint = "ctrl_native_string_free")]
    public static partial void StringFree(IntPtr p);

    // ---- Kernel ----
    [LibraryImport(Dll, EntryPoint = "ctrl_native_kernel_boot", StringMarshalling = StringMarshalling.Utf8)]
    public static partial int KernelBoot(string dataDir);

    [LibraryImport(Dll, EntryPoint = "ctrl_native_kernel_health")]
    public static partial int KernelHealth(out IntPtr outPtr);

    // ---- MCP ----
    [LibraryImport(Dll, EntryPoint = "ctrl_native_mcp_register", StringMarshalling = StringMarshalling.Utf8)]
    public static partial int McpRegister(string descriptorJson);

    [LibraryImport(Dll, EntryPoint = "ctrl_native_mcp_connect", StringMarshalling = StringMarshalling.Utf8)]
    public static partial int McpConnect(string serverId);

    [LibraryImport(Dll, EntryPoint = "ctrl_native_mcp_list_tools", StringMarshalling = StringMarshalling.Utf8)]
    public static partial int McpListTools(string serverId, out IntPtr outPtr);

    [LibraryImport(Dll, EntryPoint = "ctrl_native_mcp_invoke", StringMarshalling = StringMarshalling.Utf8)]
    public static partial int McpInvoke(string serverId, string toolName, string argumentsJson, out IntPtr outPtr);

    [LibraryImport(Dll, EntryPoint = "ctrl_native_mcp_list_installed")]
    public static partial int McpListInstalled(out IntPtr outPtr);

    [LibraryImport(Dll, EntryPoint = "ctrl_native_mcp_disconnect", StringMarshalling = StringMarshalling.Utf8)]
    public static partial int McpDisconnect(string serverId);

    // ---- Helpers ----
    public static string? TakeString(IntPtr ptr)
    {
        if (ptr == IntPtr.Zero) return null;
        try { return Marshal.PtrToStringUTF8(ptr); }
        finally { StringFree(ptr); }
    }

    public static string GetLastErrorMessage()
    {
        return TakeString(ErrorGetLast()) ?? "(no error recorded)";
    }
}
