# Hardware Strategy — Ambient AI OS Roadmap

- **Status**: Roadmap (v1 不动, ST-SS hardware-ready 是 Day 1 contract)
- **Date**: 2026-05-11
- **Parent**: `.olym/decisions/001-system-architecture.md` §1 strategic frame, §9 phase P11+
- **Implementation**: Post-launch (P11+)

---

## 1. Positioning

CTRL is **the brain**, not the device. We do not manufacture hardware. We provide:
- ST-SS protocol (CTRL profile, §3.2-3.3 of stss-protocol spec) as the device-agnostic bridge
- Open SDK for hardware vendors to integrate (Rust + TS)
- Reference implementations for 2-3 hardware demos

**Vendors come to us.** As CTRL desktop install base grows + creator ecosystem matures, hardware makers gain by integrating (more value to their device).

Analog: Intel made CPUs + standards, didn't sell laptops. CTRL is the **Intel of ambient AI**, not the Dell.

---

## 2. Why this matters (2026 market)

CES 2026 evidence:
- 36 AI smart glasses brands launched (Rokid, Looktech, Even, Brilliant)
- Apple + OpenAI joint hardware confirmed (Scientific American)
- Ray-Ban Meta Gen 2 shipping
- Bee acquired by Amazon, integrated into Alexa
- Chinese players: 千问 AI 眼镜/耳机/指环 (Alibaba), TicNote, DeskMate, Ludens

Industry consensus: **AI hardware = ambient companion sensors, not phone replacement**. Each needs a brain. CTRL fills that role.

---

## 3. Five hardware categories CTRL targets

| Category | Examples | ST-SS profile | Killer use case |
|---|---|---|---|
| **AI 眼镜** | Ray-Ban Meta, Rokid, Looktech, 千问 | high bandwidth, vision + audio | Visual context for AI assistant, real-time translation, navigation |
| **AI 录音笔/Pendant** | Bee, Friend, TicNote, Limitless (退) | audio-only, always-on | Meeting minutes, ambient memory, voice command without phone |
| **桌面摄像头** | DeskMate, custom Pi+webcam | screen + face combined | "AI 陪我 coding" — sees both what you do AND what you express |
| **电纸书** ⭐ | Boox Tab, Supernote, Daylight, reMarkable | low bandwidth, static rendering | Coding from coffee shop / outdoor / commute — **解放工位** |
| **AI 指环/耳机** | 千问指环, Apple AirPods AI mode | sensor + gesture | Silent / one-handed invocation |

---

## 4. E-ink as the killer hardware demo

The E-ink reader as **coding peripheral** is the strongest narrative differentiator for CTRL hardware story.

### 4.1 Why E-ink

| Property | E-ink physics | Maps to ST-SS |
|---|---|---|
| 2-week battery | Static display | 5 KB/s ST-SS = lowest bandwidth profile |
| Outdoor visibility | Reflective | Use anywhere, not just at desk |
| Eye comfort | No flicker | Long reading sessions |
| Low refresh rate | Inherent limitation | ST-SS coalescing = perfect match |
| Cheap displays in market | Boox/Supernote Android stack | SDK can target Android, AOSP |

### 4.2 Coding peripheral flow

```
User on desktop, IDE open
    │
    ↓ VSCode extension publishes ST-SS stream
    │   cells: current_function, pending_diff, test_status, ai_summary
    │   ops: error_appeared, ai_suggested
    │
    ↓ stream relayed via ctrl-sync or local mDNS
    │
    ↓ Boox Tab subscribes to stream
    │   E-ink renders: function listing + AI summary + diff
    │   User uses Boox stylus to annotate / mark / comment
    │   Annotations stream back as ops
    │
    ↓ Desktop CTRL receives annotations
    │   AI integrates into code review queue
    │   When user returns to desktop, work is staged
```

User scenarios:
- Coffee shop: review yesterday's PR on Boox while drinking
- Commute: annotate code on subway, sync when home
- Bed: glance at "last night's build summary"
- Walk: listen to AI explain code via earphones, look at Boox for context

### 4.3 Boox Tab Ultra technical fit

- Boox runs Android, can install third-party APK
- 10.3" 300 DPI E-ink Carta 1300
- Stylus support, Bluetooth keyboard
- WiFi + 4G option
- Battery 4000mAh = 2 weeks reading

CTRL ships `@ctrl/stss-eink-android` SDK as APK. Boox owners install, pair with CTRL desktop, use.

---

## 5. Implementation phases

### 5.1 P11 — Hardware SDK foundation

`packages/ctrl-stss-hardware/`:
- Rust crate (`@ctrl/stss-hw-rs`) — for native firmware integration
- TypeScript package (`@ctrl/stss-hw-ts`) — for Tauri/Electron hardware companion apps
- Android Kotlin lib (`@ctrl/stss-hw-android`) — for Boox + Pixel etc.
- Swift Package (`@ctrl/stss-hw-swift`) — for iOS / iPadOS / visionOS

Surface: `Device::register(DeviceManifest { device_type, power_class, bandwidth_class })` returns a `Device`; `device.create_stream(id)` returns a `Stream`; `stream.emit_cell(CellKind::HardwareReading, payload)` pushes a cell (CBOR payload typically carries `ts_ms`, `frame_summary`, `ai_label`).

*(Rust SDK example elided — implementation will land in `packages/ctrl-stss-hardware/rs/` once P11 starts.)*

### 5.2 P11.5 — Reference implementations (2-3 demos)

Pick 2 of these for ship demo:

1. **E-ink coding peripheral** — Boox Tab Ultra + VSCode extension + CTRL desktop
2. **AI 眼镜 translation** — Rokid Glasses + CTRL real-time translation keycap
3. **录音笔 meeting minutes** — TicNote + AI summary + auto-organize to project

### 5.3 P12+ — Hardware OEM program

Outreach to hardware vendors with proposition:
- Integrate `@ctrl/stss-hw` SDK in their firmware
- Get featured in ctrl-market "Hardware" section
- Revenue share on subscriptions activated through their device
- Joint marketing

Vendors gain access to CTRL user base + creator ecosystem. We gain hardware reach without manufacturing.

---

## 6. Privacy + security for hardware

Hardware always-on (Bee, Friend) creates privacy concerns. Our stance:

| Principle | Implementation |
|---|---|
| **Local-first inference** | Hardware does on-device VLM/STT if possible (Edge AI chips) |
| **No raw audio/video to cloud** | ST-SS emits semantic cells, not media; raw stays on device |
| **User-visible recording state** | Hardware MUST show recording indicator (LED, vibration, on-screen) |
| **Capability gates** | Even hardware actors check capability before emitting sensitive cells |
| **Retention policy** | Default 7 days, user-configurable |
| **Right to forget** | Event store supports cryptographic erase of past events |

We do not approve hardware certification for devices that violate these (in P12 vendor program).

---

## 7. Why NOT make our own hardware

| Factor | Risk |
|---|---|
| **Capital** | Hardware needs ¥10M+ for first run (mold, certification, supply chain) |
| **Cycle** | 18-24 month per generation; software is 6 weeks per release |
| **Inventory** | Sell-through risk, return policy, warranty |
| **Regulatory** | FCC / CE / 3C certification per region |
| **Returns / RMA** | Customer service nightmare for solo operator |
| **Capability fit** | bao is software background, not hardware |
| **Exit risk** | Software project can be abandoned cleanly; hardware leaves inventory |

CTRL as software-only is **maximum optionality** for solo operator. Hardware is a high-conviction trap.

---

## 8. Signaling discipline

Through v1 launch + early Phase 11, public-facing communication does NOT claim "CTRL hardware". We say:

- ✅ "CTRL connects to your AI glasses, recorder, e-reader"
- ✅ "CTRL is the ambient AI brain for your devices"
- ❌ "CTRL hardware" / "CTRL device" / "buy CTRL E-reader"

Reason: maintain Intel-style positioning. Devices use CTRL; CTRL is not a device.

---

## 9. References

- `.olym/specs/stss-protocol/spec.md` §3.2-3.3 — hardware profile + E-ink rendering profile
- CES 2026 AI eyewear roundup — [EDN China](https://www.ednchina.com/technews/38301.html)
- Apple-OpenAI hardware bet — [Scientific American](https://www.scientificamerican.com/article/why-apple-and-openai-are-reportedly-betting-on-ai-hardware-in-2026/)
- AI wearables 2026 review (Bee, Plaud, Limitless) — [Big Guy On Stuff](https://bigguyonstuff.com/ai-wearables-2026-honest-review/)
- Boox developer Android docs (for E-ink integration)
