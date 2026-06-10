---
name: imagegen
description: Generate images from a text prompt via fal.ai (985 endpoints aggregated)
capabilities: [image.generate]
default_args:
  model: fal-ai/flux-pro/v2
  size: "1024x1024"
trigger:
  slash: /imagegen
  alias: ["$imagegen", "$img"]
provider: fal-ai
---

# Image generation

Generate one or more images from a text prompt by calling the `image.generate`
capability. CTRL routes the call to whichever provider is active for that
capability — out of the box this is fal.ai (BYOK; configure the key in
Settings -> Providers -> fal.ai).

## Usage

- `/imagegen a cat sitting on a chair` — defaults to FLUX 2 Pro at 1024x1024
- `/imagegen --model fal-ai/seedream/v5 a cat sitting on a chair`
- `/imagegen --size 1792x1024 --num-images 4 a cat sitting on a chair`

## Notes

- The model id is the full fal.ai endpoint path; the catalogue (985 endpoints
  across image / video / audio / 3D / speech) is browsable at
  https://fal.ai/explore/models. CTRL does not maintain a curated subset —
  users pick whatever fal.ai exposes.
- Generated images save to `~/Documents/CTRL/Notes/_attachments/<timestamp>.png`
  and the SKILL returns the saved path plus the fal.ai-hosted URL.
- For video / audio generation, use `/videogen` / `/audiogen` skills (planned
  alongside this one in the same release).

ADR-002 substrate § capability-faces v19 §13.4 (2026-06-09).
