// Icon Lab — comparative renderer playground.
// Goal: decide whether ThorVG (via @lottiefiles/dotlottie-react) is the
// right unified renderer for CTRL keycaps + workshop preview cards.
//
// Three sections:
//   1) Source picker — paste any LottieFiles URL, or pick a preset chip.
//   2) Side-by-side mini comparison — same source rendered by 4 stacks
//      at keycap (48px) size. Cells are click-to-toggle.
//   3) ThorVG hero showcase — 320px preview with the full dotLottie
//      control surface: speed / direction / frame scrubber / loop /
//      mode. lottie-web cannot match any of this.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { DotLottieReact, type DotLottie } from '@lottiefiles/dotlottie-react';
import Lottie, { type LottieRefCurrentProps } from 'lottie-react';
import { IconRenderer } from '@/components/primitives';
import { KeycapCard } from '@/components/KeycapCard';
import { inferIconKindFromUrl } from '@/lib/icon';
import type { KeycapSummary } from '@/lib/kernel';
import styles from './icon-lab.module.css';

// Mock keycap summaries used only inside icon-lab to validate the
// IconRenderer at production keycap size (36px icon, full bevel + label).
// NOT wired into the real `list_keycaps` path — per
// feedback_no_mock_data_in_production these stay scoped to the dev
// playground.
const MOCK_KEYCAPS: ReadonlyArray<KeycapSummary> = [
  {
    id: 'mock-ocr',
    name: 'OCR',
    keycap_color: 'platinum',
    icon: { kind: 'lottie', src: '/lottie/ocr.json' },
  },
  {
    id: 'mock-screenshot',
    name: 'Screenshot',
    keycap_color: 'graphite',
    icon: { kind: 'lottie', src: '/lottie/screenshot.json' },
  },
];

type PlaybackMode = 'forward' | 'reverse' | 'bounce' | 'reverse-bounce';

interface Preset {
  name: string;
  src: string;
  format: 'json' | 'lottie';
  note: string;
}

// Mix of formats so we can showcase what each renderer can / can't do.
// Local samples are guaranteed to load; lottie.host samples illustrate
// the rich-case ThorVG / dotLottie target.
const PRESETS: ReadonlyArray<Preset> = [
  {
    name: 'pulse (hand-rolled .json)',
    src: '/lottie/pulse.json',
    format: 'json',
    note: 'minimum baseline — all 4 renderers should agree on this trivial case',
  },
  {
    name: 'rotate (hand-rolled .json)',
    src: '/lottie/rotate.json',
    format: 'json',
    note: 'simple rotation — lottie-web vs ThorVG should look identical here',
  },
  {
    name: 'official sample (.lottie)',
    src: '/lottie/sample.lottie',
    format: 'lottie',
    note: 'LottieFiles official dotLottie sample — multi-layer scene with eased transitions',
  },
  {
    name: 'swag piggy mascot (.lottie)',
    src: '/lottie/piggy.lottie',
    format: 'lottie',
    note: 'character mascot from LottieFiles mobile templates — analogous to the Irisy mascot use case',
  },
  {
    name: 'confetti (.lottie)',
    src: '/lottie/confetti.lottie',
    format: 'lottie',
    note: 'short celebration animation — analogous to keycap success / completion feedback',
  },
];

const isDotLottieUrl = (url: string): boolean => url.toLowerCase().endsWith('.lottie');

// === Small comparison cells ===

interface MiniCellProps {
  label: string;
  running: boolean;
  onToggle: () => void;
  children: ReactElement;
}

const MiniCell = ({ label, running, onToggle, children }: MiniCellProps): ReactElement => (
  <button
    type="button"
    className={styles.mini}
    data-running={running}
    onClick={onToggle}
    title={label}
  >
    <div className={styles.miniBody}>{children}</div>
    <span className={styles.miniLabel}>{label}</span>
  </button>
);

// 1) Static SVG fallback — generic placeholder; this is what CTRL ships
// when the manifest has no icon at all.
const StaticFallback = (): ReactElement => (
  <svg viewBox="0 0 64 64" width="48" height="48" aria-hidden="true">
    <rect x="14" y="14" width="36" height="36" rx="8" fill="none" stroke="#57a6ff" strokeWidth="3" />
    <circle cx="32" cy="32" r="6" fill="#57a6ff" />
  </svg>
);

// 2) SVG + CSS — animated when running
const CssAnimated = ({ running }: { running: boolean }): ReactElement => (
  <svg viewBox="0 0 64 64" width="48" height="48" aria-hidden="true">
    <rect
      className={running ? styles.cssBreathe : undefined}
      x="14"
      y="14"
      width="36"
      height="36"
      rx="8"
      fill="none"
      stroke="#57a6ff"
      strokeWidth="3"
      style={{ transformOrigin: '32px 32px', transformBox: 'fill-box' as const }}
    />
    <circle
      className={running ? styles.cssBlink : undefined}
      cx="32"
      cy="32"
      r="6"
      fill="#57a6ff"
    />
  </svg>
);

// 3) lottie-web — needs raw JSON, will fail on .lottie URLs
const LottieWebCell = ({ src, running }: { src: string; running: boolean }): ReactElement => {
  const [data, setData] = useState<unknown>(null);
  const [unsupported, setUnsupported] = useState(false);
  const ref = useRef<LottieRefCurrentProps>(null);

  useEffect(() => {
    if (isDotLottieUrl(src)) {
      setUnsupported(true);
      setData(null);
      return;
    }
    setUnsupported(false);
    let cancelled = false;
    void fetch(src)
      .then((r) => r.json())
      .then((j: unknown) => {
        if (!cancelled) setData(j);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const api = ref.current;
    if (!api) return;
    if (running) api.play();
    else api.stop();
  }, [running, data]);

  if (unsupported) {
    return <div className={styles.miniError}>.lottie format unsupported by lottie-web</div>;
  }
  if (!data) return <div className={styles.miniPlaceholder} />;
  return (
    <Lottie
      lottieRef={ref}
      animationData={data}
      loop
      autoplay={false}
      style={{ width: 48, height: 48 }}
    />
  );
};

// 4) ThorVG / dotLottie via IconRenderer — the production path.
// IconRenderer lazy-loads ThorVG WASM and dispatches by Icon.kind.
// Static .svg / glyph variants would never touch WASM; lottie/dotlottie
// share one WASM singleton across mounts.
const DotLottieCell = ({ src, running }: { src: string; running: boolean }): ReactElement => {
  const kind = inferIconKindFromUrl(src);
  if (kind !== 'lottie' && kind !== 'dotlottie') {
    return <div className={styles.miniError}>not a Lottie URL</div>;
  }
  return (
    <IconRenderer
      icon={{ kind, src }}
      size={48}
      playing={running}
      ariaLabel="dotLottie cell"
    />
  );
};

// === Hero — big ThorVG showcase ===

const HeroShowcase = ({ src }: { src: string }): ReactElement => {
  const [dotLottie, setDotLottie] = useState<DotLottie | null>(null);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<PlaybackMode>('forward');
  const [loop, setLoop] = useState(true);
  const [frame, setFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [playing, setPlaying] = useState(true);

  const handleRef = useCallback((instance: DotLottie | null): void => {
    setDotLottie(instance);
  }, []);

  // Re-sync controls every time a new animation loads.
  useEffect(() => {
    if (!dotLottie) return;
    const onLoad = (): void => {
      setTotalFrames(dotLottie.totalFrames || 0);
      setFrame(dotLottie.currentFrame || 0);
    };
    const onFrame = (): void => {
      setFrame(dotLottie.currentFrame || 0);
    };
    dotLottie.addEventListener('load', onLoad);
    dotLottie.addEventListener('frame', onFrame);
    if (dotLottie.totalFrames) setTotalFrames(dotLottie.totalFrames);
    return () => {
      dotLottie.removeEventListener('load', onLoad);
      dotLottie.removeEventListener('frame', onFrame);
    };
  }, [dotLottie]);

  useEffect(() => {
    if (!dotLottie) return;
    dotLottie.setSpeed(speed);
  }, [dotLottie, speed]);

  useEffect(() => {
    if (!dotLottie) return;
    dotLottie.setMode(mode);
  }, [dotLottie, mode]);

  useEffect(() => {
    if (!dotLottie) return;
    dotLottie.setLoop(loop);
  }, [dotLottie, loop]);

  const handlePlayPause = (): void => {
    if (!dotLottie) return;
    if (playing) {
      dotLottie.pause();
      setPlaying(false);
    } else {
      dotLottie.play();
      setPlaying(true);
    }
  };

  const handleStop = (): void => {
    if (!dotLottie) return;
    dotLottie.stop();
    setPlaying(false);
  };

  const handleScrub = (n: number): void => {
    if (!dotLottie) return;
    dotLottie.pause();
    setPlaying(false);
    dotLottie.setFrame(n);
    setFrame(n);
  };

  return (
    <div className={styles.heroWrap}>
      <div className={styles.heroPreview}>
        <DotLottieReact
          src={src}
          autoplay
          loop={loop}
          speed={speed}
          mode={mode}
          dotLottieRefCallback={handleRef}
          style={{ width: 320, height: 320 }}
        />
      </div>
      <div className={styles.heroControls}>
        <div className={styles.ctrlRow}>
          <button type="button" className={styles.ctrlBtn} onClick={handlePlayPause}>
            {playing ? 'pause' : 'play'}
          </button>
          <button type="button" className={styles.ctrlBtn} onClick={handleStop}>
            stop
          </button>
          <span className={styles.frameReadout}>
            frame {Math.round(frame)} / {Math.max(0, totalFrames - 1)}
          </span>
        </div>

        <label className={styles.ctrlField}>
          <span className={styles.ctrlLabel}>speed · {speed.toFixed(2)}x</span>
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
          />
        </label>

        <label className={styles.ctrlField}>
          <span className={styles.ctrlLabel}>frame scrubber</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, totalFrames - 1)}
            step={1}
            value={frame}
            onChange={(e) => handleScrub(parseInt(e.target.value, 10))}
          />
        </label>

        <div className={styles.ctrlRow}>
          <span className={styles.ctrlLabel}>mode</span>
          {(['forward', 'reverse', 'bounce', 'reverse-bounce'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={styles.ctrlChip}
              data-active={mode === m}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <div className={styles.ctrlRow}>
          <label className={styles.ctrlToggle}>
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
            <span>loop</span>
          </label>
        </div>

        <p className={styles.heroNote}>
          Every button above hits the live ThorVG WASM instance through{' '}
          <code>setSpeed / setMode / setLoop / setFrame</code> on the
          DotLottie instance. lottie-web has no equivalent unified API —
          it would take a wrapper plus losing .lottie zip support.
        </p>
      </div>
    </div>
  );
};

// === Source bar ===

interface SourceBarProps {
  value: string;
  onChange: (next: string) => void;
}

const SourceBar = ({ value, onChange }: SourceBarProps): ReactElement => {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const submit = (): void => {
    if (draft.trim()) onChange(draft.trim());
  };

  return (
    <div className={styles.source}>
      <div className={styles.sourceInputRow}>
        <input
          className={styles.sourceInput}
          type="url"
          placeholder="paste a Lottie URL (.json or .lottie) and press Load"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button type="button" className={styles.sourceBtn} onClick={submit}>
          load
        </button>
      </div>
      <div className={styles.presetRow}>
        <span className={styles.presetTitle}>presets</span>
        {PRESETS.map((p) => (
          <button
            key={p.src}
            type="button"
            className={styles.presetChip}
            data-active={value === p.src}
            onClick={() => onChange(p.src)}
            title={p.note}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
};

// === Page ===

export const IconLabRoute = (): ReactElement => {
  const [src, setSrc] = useState<string>(PRESETS[0]!.src);
  const [running, setRunning] = useState<Record<string, boolean>>({});

  const toggle = (k: string): void => {
    setRunning((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const playAll = (): void => {
    setRunning({ static: true, css: true, lottie: true, thorvg: true });
  };
  const stopAll = (): void => setRunning({});

  const currentPreset = PRESETS.find((p) => p.src === src);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Icon Lab</h1>
          <p className={styles.intro}>
            Decide whether ThorVG (via dotLottie) replaces our SVG + lottie-web
            split. Paste a Lottie URL or pick a preset, then compare visual
            fidelity at keycap size and explore the dotLottie control surface
            in the hero showcase.
          </p>
        </div>
      </header>

      <SourceBar value={src} onChange={setSrc} />

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>0 · IconRenderer dispatch demo</h2>
          <p className={styles.sectionSub}>
            One primitive (<code>IconRenderer</code>) dispatches by{' '}
            <code>Icon.kind</code>. Static variants render natively; lottie /
            dotlottie variants lazy-load ThorVG WASM. This is the production
            path every keycap, mascot, and workshop card goes through.
          </p>
        </header>
        <div className={styles.grid}>
          <MiniCell label="kind: glyph" running={false} onToggle={() => {}}>
            <IconRenderer
              icon={{ kind: 'glyph', char: 'T' }}
              size={48}
              ariaLabel="translate keycap"
            />
          </MiniCell>
          <MiniCell label="kind: glyph (2-char)" running={false} onToggle={() => {}}>
            <IconRenderer
              icon={{ kind: 'glyph', char: 'Aa' }}
              size={48}
              ariaLabel="font keycap"
            />
          </MiniCell>
          <MiniCell label="kind: dotlottie" running={true} onToggle={() => {}}>
            <IconRenderer
              icon={{ kind: 'dotlottie', src: '/lottie/piggy.lottie' }}
              size={48}
              playing
              ariaLabel="piggy mascot"
            />
          </MiniCell>
          <MiniCell label="kind: lottie (.json)" running={true} onToggle={() => {}}>
            <IconRenderer
              icon={{ kind: 'lottie', src: '/lottie/pulse.json' }}
              size={48}
              playing
              ariaLabel="pulse animation"
            />
          </MiniCell>
        </div>
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>1 · side-by-side at keycap size</h2>
          <p className={styles.sectionSub}>
            Same source, 4 renderers, 48px output. Click any cell to toggle
            animation. {currentPreset?.note ? `(${currentPreset.note})` : null}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={playAll}>
              play all
            </button>
            <button type="button" className={styles.btn} onClick={stopAll}>
              stop all
            </button>
          </div>
        </header>

        <div className={styles.grid}>
          <MiniCell label="static svg" running={false} onToggle={() => {}}>
            <StaticFallback />
          </MiniCell>
          <MiniCell
            label="svg + css"
            running={running.css ?? false}
            onToggle={() => toggle('css')}
          >
            <CssAnimated running={running.css ?? false} />
          </MiniCell>
          <MiniCell
            label="lottie-web"
            running={running.lottie ?? false}
            onToggle={() => toggle('lottie')}
          >
            <LottieWebCell src={src} running={running.lottie ?? false} />
          </MiniCell>
          <MiniCell
            label="iconrenderer (thorvg)"
            running={running.thorvg ?? false}
            onToggle={() => toggle('thorvg')}
          >
            <DotLottieCell src={src} running={running.thorvg ?? false} />
          </MiniCell>
        </div>
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>2 · thorvg hero showcase</h2>
          <p className={styles.sectionSub}>
            Same source rendered at 320×320 with the full dotLottie control
            surface — the bits lottie-web cannot match: speed multiplier,
            playback mode, frame-accurate scrubbing, loop toggle.
          </p>
        </header>

        <HeroShowcase src={src} />
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>3 · keycap mock — OCR + Screenshot @ production size</h2>
          <p className={styles.sectionSub}>
            Two mock keycaps mounted through the real <code>KeycapCard</code> at
            the keyboard&apos;s actual bevel + 36px icon size. Validates the
            full path: <code>normalizeIcon</code> → <code>IconRenderer</code> →
            ThorVG WASM inside a production card chrome (LED, embossed icon,
            label). Animations: hand-rolled <code>ocr.json</code> (scan line
            sweeping a paginated frame) + <code>screenshot.json</code> (corner
            brackets pulsing with a center capture dot).
          </p>
        </header>
        <div className={styles.keycapRow}>
          {MOCK_KEYCAPS.map((kc) => (
            <KeycapCard
              key={kc.id}
              keycap={kc}
              onActivate={() => {
                // Dev playground — no real keycap behind these. The real
                // production wire goes through useKeycaps() in the Keyboard.
              }}
            />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>4 · takeaway</h2>
        </header>
        <div className={styles.takeaway}>
          <div className={styles.tCol}>
            <h3>where ThorVG wins</h3>
            <ul>
              <li>One pipeline for static SVG + Lottie + .lottie zip bundles</li>
              <li>Native .lottie format (themes, slots, state machines bundled)</li>
              <li>Unified setSpeed / setMode / setFrame / setLoop API</li>
              <li>Worker thread variant (DotLottieWorkerReact) for heavy scenes</li>
            </ul>
          </div>
          <div className={styles.tCol}>
            <h3>where it loses</h3>
            <ul>
              <li>~680 KB chunk for first paint of any Lottie-using surface</li>
              <li>WASM instantiation cost on first frame (mitigate via prefetch)</li>
              <li>Static fallback still needs a CSS glyph path during WASM boot</li>
              <li>LLM can&apos;t generate .lottie / Lottie JSON the way it generates SVG</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};
