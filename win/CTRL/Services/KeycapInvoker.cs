// SPDX-License-Identifier: All-Rights-Reserved
//
// Shared helper for routing a keycap click through Mcp.Invoke on the
// demo MCP server. Used by WorkspacePage so the page itself stays focused
// on UI rendering. Once tool manifests land (P5+), this helper goes away
// in favour of manifest-driven actor invocation through the kernel.

using System;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using CTRL.Bindings;

namespace CTRL.Services;

internal static class KeycapInvoker
{
    /// <summary>
    /// Invoke the demo server's <c>echo</c> tool with the keycap id and
    /// return the unwrapped text content. Errors are formatted as readable
    /// strings rather than thrown.
    /// </summary>
    public static async Task<string> RunEcho(string keycapId)
    {
        var setupErr = await App.ReadyTask;
        if (setupErr is not null) return $"Kernel / MCP not ready:\n\n{setupErr}";

        try
        {
            var argsJson = JsonSerializer.Serialize(new { message = $"hello from keycap '{keycapId}'" });
            var result = await Task.Run(() =>
                Mcp.Invoke(App.DemoMcpServerId, "echo", argsJson));
            return string.IsNullOrEmpty(result) ? "(empty response)" : ExtractText(result);
        }
        catch (KernelException kex)
        {
            return $"MCP invoke failed (code {kex.Code}):\n{kex.Message}";
        }
        catch (Exception ex)
        {
            return $"Unexpected ({ex.GetType().Name}):\n{ex.Message}";
        }
    }

    /// <summary>
    /// Unwrap the rmcp CallToolResult envelope
    /// (<c>{"content":[{"type":"text","text":"..."}]}</c>) and concatenate
    /// the text-typed blocks. Falls back to the raw JSON for unknown shapes.
    /// </summary>
    private static string ExtractText(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("content", out var content)
                || content.ValueKind != JsonValueKind.Array)
            {
                return raw;
            }

            var sb = new StringBuilder();
            foreach (var item in content.EnumerateArray())
            {
                if (item.TryGetProperty("type", out var type)
                    && type.GetString() == "text"
                    && item.TryGetProperty("text", out var text))
                {
                    if (sb.Length > 0) sb.AppendLine();
                    sb.Append(text.GetString());
                }
            }
            return sb.Length > 0 ? sb.ToString() : raw;
        }
        catch (JsonException)
        {
            return raw;
        }
    }
}
