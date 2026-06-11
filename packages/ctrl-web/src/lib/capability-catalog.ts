// Irisy capability catalog — the SSOT for what CTRL can do for a user.
//
// Drives two surfaces (ADR-003 §8 v6 morphing-conversation rebuild):
//   1. the visible capability-card "floor" (low-barrier discovery — users
//      SEE concrete effects and click, instead of facing a blank prompt;
//      bao 2026-06-11: CTRL is a low-barrier assistant for general users)
//   2. Irisy's self-knowledge (what it tells users it can do / whether a
//      request is doable now vs needs an install)
//
// Curated from a 2-track product+usage benchmark (2026-06-11):
//   - a16z Top-100 Gen-AI Consumer Apps (6th ed) + NBER "How People Use
//     ChatGPT" + Anthropic Economic Index — usage frequency + willingness
//     to pay among GENERAL (non-developer) users.
//   - capability -> delivery-channel mapping (LLM-API / MCP / Skill) so
//     each card knows what backs it.
//
// Accuracy notes from research (do not regress these):
//   - HTML/artifact (web page, poster, SVG, React, Mermaid) = Claude's
//     flagship, a plain provider API call. Claude does NOT raster-generate.
//   - Raster image generation = OpenAI gpt-image-2 / Google Nano-Banana
//     (Gemini Flash Image) / Flux — NOT Claude, NOT "Codex". BYOK.
//   - Standalone image gen is commoditised; the paid hooks are photo
//     editing / video / voice / transcription / study-help / resume.

export type DeliveryChannel =
  | 'llm-api' // model emits it directly (text/code/SVG/HTML/JSON) — zero install once a provider is configured
  | 'mcp' // needs an MCP server / external API / side effect
  | 'skill'; // a SKILL.md prompt-pack: instructions + template, no new code

export type Tier = 'high' | 'med' | 'low';

export interface Capability {
  id: string;
  /** Effect-first, user-facing label — what the user GETS, not the tech. */
  label: string;
  /** One line: the concrete effect, so a general user understands at a glance. */
  hint: string;
  /** general-user usage frequency (NBER / a16z). */
  usage: Tier;
  /** consumer willingness-to-pay (a16z). */
  pay: Tier;
  channel: DeliveryChannel;
  /** What actually backs it (provider model / MCP / skill name). */
  delivers: string;
  /** input -> output shape, for the morph layer to pick a viewer. */
  io: string;
  /** True = works with just a configured provider, no extra install.
   *  These are the low-barrier floor cards (lead with them). */
  zeroInstall: boolean;
  /** Composer pre-fill when a user clicks the card — a ready-to-complete
   *  prompt so a general user sees what to do next instead of a blank box. */
  starter?: string;
}

export interface CapabilityCategory {
  id: string;
  /** User-facing category title (effect-framed). */
  title: string;
  /** Why it leads / where it sits in the consumer value map. */
  note: string;
  capabilities: Capability[];
}

// Ordered consumer-first: categories 1-4 are where general-user usage and
// willingness-to-pay overlap most; raw coding is intentionally last/low for
// a low-barrier consumer audience (it stays a face via opencode, not a
// headline card).
export const CAPABILITY_CATALOG: CapabilityCategory[] = [
  {
    id: 'write',
    title: 'Write & Communicate',
    note: 'The #1 task across every usage study; broadest ordinary appeal.',
    capabilities: [
      {
        id: 'draft-polish',
        label: 'Draft or polish text',
        hint: 'Write or rewrite an email, message, or post',
        usage: 'high',
        pay: 'med',
        channel: 'llm-api',
        delivers: 'active provider',
        io: 'text -> text',
        zeroInstall: true,
        starter: 'Draft an email to ',
      },
      {
        id: 'tone-translate',
        label: 'Change tone / translate',
        hint: 'Formalize, shorten, or translate a selection in place',
        usage: 'high',
        pay: 'med',
        channel: 'llm-api',
        delivers: 'active provider',
        io: 'text + target -> text',
        zeroInstall: true,
        starter: 'Translate this to English: ',
      },
      {
        id: 'resume',
        label: 'Resume & cover letter',
        hint: 'Turn your facts into a formatted, on-target application doc',
        usage: 'med',
        pay: 'high',
        channel: 'skill',
        delivers: 'resume skill (SKILL.md template)',
        io: 'facts -> formatted doc',
        zeroInstall: false,
      },
      {
        id: 'marketing-copy',
        label: 'Marketing copy',
        hint: 'Captions, ads, product descriptions — several variants to pick',
        usage: 'med',
        pay: 'high',
        channel: 'skill',
        delivers: 'copy skill (AIDA/PAS frameworks)',
        io: 'brief -> variants',
        zeroInstall: false,
      },
    ],
  },
  {
    id: 'understand',
    title: 'Summarize & Understand',
    note: 'High usage; transcription is a clean discrete pay event.',
    capabilities: [
      {
        id: 'summarize',
        label: 'Summarize anything',
        hint: 'Digest a document, article, or long thread to the key points',
        usage: 'high',
        pay: 'med',
        channel: 'llm-api',
        delivers: 'active provider',
        io: 'long text -> digest',
        zeroInstall: true,
        starter: 'Summarize this:\n\n',
      },
      {
        id: 'transcribe-meeting',
        label: 'Transcribe & recap a meeting',
        hint: 'Audio to notes with action items — no bot joins your call',
        usage: 'med',
        pay: 'high',
        channel: 'mcp',
        delivers: 'STT MCP (Whisper / Deepgram) + provider',
        io: 'audio -> notes + actions',
        zeroInstall: false,
      },
      {
        id: 'extract-actions',
        label: 'Extract action items',
        hint: 'Pull owner + task + due from an email, doc, or transcript',
        usage: 'high',
        pay: 'med',
        channel: 'llm-api',
        delivers: 'active provider (structured output)',
        io: 'content -> task list',
        zeroInstall: true,
        starter: 'Pull the action items (owner, task, due) from:\n\n',
      },
    ],
  },
  {
    id: 'learn',
    title: 'Learn, Advise & Research',
    note: 'The largest usage bucket (NBER: practical guidance + info-seeking).',
    capabilities: [
      {
        id: 'how-to',
        label: 'Practical advice / how-to',
        hint: 'Decision support and step-by-step guidance for a real situation',
        usage: 'high',
        pay: 'med',
        channel: 'llm-api',
        delivers: 'active provider',
        io: 'question -> guidance',
        zeroInstall: true,
        starter: 'How do I ',
      },
      {
        id: 'tutor',
        label: 'Tutor / homework help',
        hint: 'A worked explanation, not just the answer',
        usage: 'high',
        pay: 'high',
        channel: 'llm-api',
        delivers: 'active provider (+ vision for photos of problems)',
        io: 'problem -> worked explanation',
        zeroInstall: true,
        starter: 'Explain step by step: ',
      },
      {
        id: 'research-web',
        label: 'Research with sources',
        hint: 'A cited answer pulled from the live web, every claim linked',
        usage: 'high',
        pay: 'med',
        channel: 'mcp',
        delivers: 'web-search MCP / provider web tool',
        io: 'query -> cited answer',
        zeroInstall: false,
      },
    ],
  },
  {
    id: 'visual',
    title: 'Create Visual & Media',
    note: 'Highest direct willingness-to-pay. Lead with HTML (zero-install); image gen is table-stakes, the paid hooks are photo-edit / video / voice.',
    capabilities: [
      {
        id: 'html-artifact',
        label: 'Build a web page / poster',
        hint: 'Describe it, get a real HTML page, poster, chart, or mini-app',
        usage: 'med',
        pay: 'high',
        channel: 'llm-api',
        delivers: 'Claude Artifacts (HTML/SVG/React/Mermaid)',
        io: 'description -> runnable page',
        zeroInstall: true,
        starter: 'Build a single-page HTML for ',
      },
      {
        id: 'image-generate',
        label: 'Generate an image',
        hint: 'A picture from a text prompt (and an optional reference)',
        usage: 'med',
        pay: 'high',
        channel: 'mcp',
        delivers: 'gpt-image-2 / Nano-Banana / Flux (BYOK)',
        io: 'prompt (+ref) -> image',
        zeroInstall: false,
      },
      {
        id: 'photo-edit',
        label: 'Edit / restore a photo',
        hint: 'Remove background, retouch, upscale, or make a headshot',
        usage: 'high',
        pay: 'high',
        channel: 'mcp',
        delivers: 'image-edit API (gpt-image / Nano-Banana edit mode)',
        io: 'photo -> edited photo',
        zeroInstall: false,
      },
      {
        id: 'video-generate',
        label: 'Make a short video',
        hint: 'A clip from a script or image — a backgrounded job you return to',
        usage: 'med',
        pay: 'high',
        channel: 'mcp',
        delivers: 'Sora 2 / Veo 3 / Kling (BYOK, async)',
        io: 'prompt/script -> clip',
        zeroInstall: false,
      },
      {
        id: 'voice-tts',
        label: 'Voiceover / dubbing',
        hint: 'Turn text into natural speech in a chosen voice',
        usage: 'med',
        pay: 'high',
        channel: 'mcp',
        delivers: 'ElevenLabs / TTS MCP (BYOK)',
        io: 'text + voice -> audio',
        zeroInstall: false,
      },
    ],
  },
  {
    id: 'build',
    title: 'Build & Make',
    note: 'Rising 2026 frontier; slides + pages monetize well.',
    capabilities: [
      {
        id: 'slides',
        label: 'Generate slides',
        hint: 'An outline you approve, then a full deck',
        usage: 'med',
        pay: 'high',
        channel: 'llm-api',
        delivers: 'active provider -> SmartTable/HTML render',
        io: 'topic -> deck',
        zeroInstall: true,
        starter: 'Make a slide outline about ',
      },
      {
        id: 'coding',
        label: 'Code a feature',
        hint: 'Read, write, and refactor code in your project',
        usage: 'low', // low among general users; high for devs
        pay: 'high',
        channel: 'mcp',
        delivers: 'opencode (Coding face)',
        io: 'intent -> code changes',
        zeroInstall: false,
      },
    ],
  },
  {
    id: 'organize',
    title: 'Organize, Plan & Do',
    note: 'HBR #2 ("organizing my life"); the agentic frontier.',
    capabilities: [
      {
        id: 'plan',
        label: 'Plan / itinerary / breakdown',
        hint: 'Turn a goal into an ordered, doable plan',
        usage: 'high',
        pay: 'med',
        channel: 'llm-api',
        delivers: 'active provider',
        io: 'goal -> plan',
        zeroInstall: true,
        starter: 'Make me a plan to ',
      },
      {
        id: 'scheduled-task',
        label: 'Recurring task',
        hint: 'e.g. every Monday 9am refresh these metrics — set once, runs itself',
        usage: 'med',
        pay: 'high',
        channel: 'mcp',
        delivers: 'kernel scheduler + the task own capability',
        io: 'standing intent -> repeated runs',
        zeroInstall: false,
      },
    ],
  },
  {
    id: 'data',
    title: 'Analyze Data',
    note: 'Renders as the native artifact (chart/table), not a chat bubble.',
    capabilities: [
      {
        id: 'analyze-table',
        label: 'Analyze a spreadsheet',
        hint: 'Ask a question, get a chart or table back — not a paragraph',
        usage: 'med',
        pay: 'high',
        channel: 'llm-api',
        delivers: 'active provider -> SmartTable / chart viewer',
        io: 'data + question -> chart/table',
        zeroInstall: true,
        starter: 'Analyze this data and chart it:\n\n',
      },
      {
        id: 'ocr-extract',
        label: 'Extract from image / PDF',
        hint: 'Pull structured text or a table out of a scan or photo',
        usage: 'med',
        pay: 'med',
        channel: 'mcp',
        delivers: 'OCR MCP (Mistral OCR / local Vision)',
        io: 'image/PDF -> table/text',
        zeroInstall: false,
      },
    ],
  },
];

/** Floor cards = zero-install capabilities, highest usage first. These are
 *  what a fresh user sees and can click immediately with only a provider
 *  configured — the low-barrier entry (no MCP/skill install required). */
export function floorCapabilities(): Capability[] {
  return CAPABILITY_CATALOG.flatMap((c) => c.capabilities)
    .filter((cap) => cap.zeroInstall)
    .sort((a, b) => tierRank(b.usage) - tierRank(a.usage));
}

function tierRank(t: Tier): number {
  return t === 'high' ? 3 : t === 'med' ? 2 : 1;
}
