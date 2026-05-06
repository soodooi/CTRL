// Synthesized launcher sound effects via WebAudio. Zero asset weight.
// Defaults to OFF — keyboard sounds in shared workspaces are intrusive.
// User opts in via SettingsSheet → 声音反馈 toggle.

const ENABLED_KEY = 'ctrl.sound.v1';

export type SoundKind =
  | 'press'        // mech keycap thunk on hotkey/click
  | 'error'        // low dud on action failure
  | 'success-ai'   // ascending chime on AI / long-form result
  | 'copy'         // coin ting on copy
  | 'wake';        // subtle click on hotkey wake (Rust-emitted hotkey event)

let ctx: AudioContext | null = null;
let cachedEnabled: boolean | null = null;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

export function isSoundEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  try {
    cachedEnabled = localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    cachedEnabled = false;
  }
  return cachedEnabled;
}

export function setSoundEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // best-effort: localStorage disabled — runtime cache still applies for this session
  }
}

interface OscSpec {
  type: OscillatorType;
  freq: number;
  /** Optional frequency target — when present, slides from `freq` to `freqEnd` over duration. */
  freqEnd?: number;
  duration: number;
  /** Peak gain multiplier (multiplied with master volume). 0..1 */
  gain: number;
  /** Delay in seconds from now. */
  delay?: number;
}

function playOsc(audioCtx: AudioContext, master: number, spec: OscSpec): void {
  const start = audioCtx.currentTime + (spec.delay ?? 0);
  const end = start + spec.duration;
  const osc = audioCtx.createOscillator();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqEnd), end);
  }

  const gain = audioCtx.createGain();
  // Linear attack, exponential decay envelope
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(spec.gain * master, start + Math.min(0.005, spec.duration * 0.1));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

export function playSound(kind: SoundKind): void {
  if (!isSoundEnabled()) return;
  const audioCtx = getCtx();
  if (!audioCtx) return;

  // Resume on first user gesture (browser autoplay policy)
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => undefined);
  }

  const master = 0.6;
  switch (kind) {
    case 'press':
      // Click + body — two oscillators stacked for mech-key feel
      playOsc(audioCtx, master, { type: 'square', freq: 1200, duration: 0.012, gain: 0.18 });
      playOsc(audioCtx, master, { type: 'triangle', freq: 90, freqEnd: 60, duration: 0.07, gain: 0.22 });
      break;
    case 'error':
      playOsc(audioCtx, master, { type: 'triangle', freq: 220, freqEnd: 110, duration: 0.22, gain: 0.22 });
      break;
    case 'success-ai':
      // Two-note ascending chime C5 → G5
      playOsc(audioCtx, master, { type: 'sine', freq: 523.25, duration: 0.08, gain: 0.16 });
      playOsc(audioCtx, master, {
        type: 'sine',
        freq: 783.99,
        duration: 0.18,
        gain: 0.18,
        delay: 0.07,
      });
      break;
    case 'copy':
      // Coin ting — A6 → D7 sweep, bell decay
      playOsc(audioCtx, master, {
        type: 'sine',
        freq: 1760,
        freqEnd: 2349,
        duration: 0.32,
        gain: 0.12,
      });
      break;
    case 'wake':
      playOsc(audioCtx, master, { type: 'sine', freq: 880, duration: 0.04, gain: 0.08 });
      break;
  }
}
