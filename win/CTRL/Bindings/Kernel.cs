// SPDX-License-Identifier: All-Rights-Reserved
//
// Idiomatic C# wrapper around CtrlNative.cs raw P/Invoke layer.
// Throws KernelException on -3 from native side, including last error message.

using System;

namespace CTRL.Bindings;

public sealed class KernelException : Exception
{
    public int Code { get; }
    public KernelException(int code, string message) : base(message)
    {
        Code = code;
    }
}

public static class Kernel
{
    public static void Boot(string dataDir)
    {
        var rc = CtrlNative.KernelBoot(dataDir);
        if (rc != 0) Throw(rc);
    }

    public static string Health()
    {
        var rc = CtrlNative.KernelHealth(out var ptr);
        if (rc != 0) Throw(rc);
        return CtrlNative.TakeString(ptr) ?? string.Empty;
    }

    private static void Throw(int rc)
    {
        var msg = rc switch
        {
            -1 => "null pointer / invalid input",
            -2 => "UTF-8 decode failure",
            -3 => CtrlNative.GetLastErrorMessage(),
            -99 => "unexpected internal error",
            _ => $"unknown error code {rc}",
        };
        throw new KernelException(rc, msg);
    }
}

public static class Mcp
{
    public static void Register(string descriptorJson)
    {
        var rc = CtrlNative.McpRegister(descriptorJson);
        if (rc != 0) Kernel_Throw(rc);
    }

    public static void Connect(string serverId)
    {
        var rc = CtrlNative.McpConnect(serverId);
        if (rc != 0) Kernel_Throw(rc);
    }

    public static string ListTools(string serverId)
    {
        var rc = CtrlNative.McpListTools(serverId, out var ptr);
        if (rc != 0) Kernel_Throw(rc);
        return CtrlNative.TakeString(ptr) ?? "[]";
    }

    public static string Invoke(string serverId, string toolName, string argumentsJson)
    {
        var rc = CtrlNative.McpInvoke(serverId, toolName, argumentsJson, out var ptr);
        if (rc != 0) Kernel_Throw(rc);
        return CtrlNative.TakeString(ptr) ?? "null";
    }

    public static string ListInstalled()
    {
        var rc = CtrlNative.McpListInstalled(out var ptr);
        if (rc != 0) Kernel_Throw(rc);
        return CtrlNative.TakeString(ptr) ?? "[]";
    }

    public static void Disconnect(string serverId)
    {
        var rc = CtrlNative.McpDisconnect(serverId);
        if (rc != 0) Kernel_Throw(rc);
    }

    private static void Kernel_Throw(int rc)
    {
        var msg = rc switch
        {
            -1 => "null pointer / invalid input",
            -2 => "UTF-8 decode failure",
            -3 => CtrlNative.GetLastErrorMessage(),
            -99 => "unexpected internal error",
            _ => $"unknown error code {rc}",
        };
        throw new KernelException(rc, msg);
    }
}
