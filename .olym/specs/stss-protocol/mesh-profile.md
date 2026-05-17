---
parent_adr: ADR-003
status: Draft v0.1
last_updated: 2026-05-16
---

# Mesh Profile (ST-SS extension for cross-device)

抽自 [ADR-003 §5 Pairing flow](../../../.claude/ADR/003-multi-device-mesh.md#5-pairing-flow)，因属协议实现细节不属架构决策。**本文档是真实来源**；ADR-003 §5 仅保留作历史。

详见 `stss-protocol/spec.md` 主 spec（本文件是其 mesh profile 扩展）。

---

## 1. Pairing Flow

### 1.1 Initial Pair

两个设备首次配对：

```
Device A (already in mesh)                 Device B (joining)
   │                                          │
   │  1. User: Settings → "Add device"        │
   │  2. Generate one-time pairing code       │
   │     (60-byte payload, encodes:           │
   │      - A's device public key             │
   │      - relay endpoint URL                │
   │      - 8-byte challenge nonce)           │
   │  3. Render QR + 6-digit fallback         │
   │                                          │
   │                                          │  4. User: Settings → "Join mesh"
   │                                          │  5. Scan QR / type 6-digit code
   │                                          │  6. Generate B's identity key
   │                                          │  7. POST /pair (relay) with:
   │                                          │     - B's public key
   │                                          │     - A's public key from QR
   │                                          │     - signed challenge
   │  8. Relay routes pair-offer to A         │←─────── pair-offer
   │  9. Push notification to A (Web Push     │
   │     subscription if available)           │
   │  10. User confirms on A                  │
   │  11. A → X3DH handshake                  │
   │  12. Encrypted session established       │
   │  13. A sends mesh document snapshots     │ ────────→
   │                                          │  14. B writes local copy
   │                                          │  15. Pairing complete
```

**约束**：
- QR 不含 secret（仅一次性 challenge）
- Pairing code 5 分钟过期
- Replay 攻击失败（challenge 绑定 A 公钥 + 双方签名）

### 1.2 Subsequent Connect (already paired)

两设备开机各自开 persistent WSS 到 `/signal`。互见 online 广播 → 尝试 WebRTC ICE exchange → 1-2 秒内升 P2P。
若 WebRTC 失败（双方 symmetric NAT）→ relay 自动 fallback，用户无感。

---

## 2. QR Payload Format

60-byte binary payload（base64url 编码到 QR）：

| Offset | Bytes | 字段 | 说明 |
|--------|-------|------|------|
| 0 | 32 | A's curve25519 public key | A 的长期身份公钥 |
| 32 | 20 | Relay endpoint URL | UTF-8，padded with `\0` |
| 52 | 8 | Challenge nonce | 随机 8 字节 |

6-digit fallback：以上 payload 取 HMAC-SHA256 截断为 6 位 base10 + 短期映射表（仅短链场景）。

---

## 3. Handshake（X3DH + Double Ratchet）

加密层用 **vodozemac** (Matrix.org fork of Olm)，Rust 桌面 + WASM PWA。
**禁止 Megolm**（CTRL 单用户多设备，无群加密需求）。

详 vodozemac 文档：https://github.com/matrix-org/vodozemac

---

## 4. 关联

- 上游：[ADR-003](../../../.claude/ADR/003-multi-device-mesh.md)
- 协议主 spec：[stss-protocol/spec.md](./spec.md)
- 实现：`packages/ctrl-mesh/`（skeleton 已存在，P4.5 进行中）

---

## 修订

- 2026-05-16: 抽自 ADR-003 §5，初始版（zeus）
