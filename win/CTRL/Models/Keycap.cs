// SPDX-License-Identifier: All-Rights-Reserved
//
// Stub keycap model for the W3.4 launcher grid. Real declarative manifests
// (5 source types: builtin / mcp / oauth / local_agent / stss) land via
// @ctrl/kernel-sdk and tool-manifest spec in P5+. For now we only need an
// id, a display label, and an icon glyph to populate the pool UI.

using System.Collections.Generic;

namespace CTRL.Models;

public sealed record Keycap(string Id, string Name, string Icon);

public static class BuiltinKeycaps
{
    /// <summary>
    /// The v1 Top 15 keycaps (5 P0 + 5 P1 + 5 differentiation) per
    /// .olym/steering/ctrl-strategy.md. Stub data only — behaviour
    /// arrives once manifests + actors are wired.
    /// </summary>
    public static readonly IReadOnlyList<Keycap> All = new[]
    {
        // P0 (v1.0)
        new Keycap("clipboard", "Clipboard", "📋"),
        new Keycap("ocr",       "OCR",       "👁"),
        new Keycap("translate", "Translate", "🌐"),
        new Keycap("text",      "Text",      "📝"),
        new Keycap("chat",      "Chat",      "💬"),

        // P1 (v1.1)
        new Keycap("window",    "Windows",   "🪟"),
        new Keycap("pdf",       "PDF",       "📄"),
        new Keycap("latex",     "LaTeX",     "∫"),
        new Keycap("smart",     "Smart",     "🧠"),
        new Keycap("record",    "Record",    "🎥"),

        // Differentiation (v1.0-1.2)
        new Keycap("snippet",   "Snippet",   "✂"),
        new Keycap("code",      "Code",      "💻"),
        new Keycap("email",     "Email",     "✉"),
        new Keycap("meeting",   "Meeting",   "🎙"),
        new Keycap("sync",      "Sync",      "🔄"),
    };
}
