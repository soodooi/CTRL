// Brand theme data hook — feeds CTRL OKLCh tokens into dotLottie's
// `slot_*` color rules per .olym/skills/thorvg/SKILL.md §3.3 + §5.1.
//
// Approach: resolve each CSS variable through a hidden probe element so
// the browser does the OKLCh → sRGB conversion natively, then emit a
// dotLottie Theme JSON for `setThemeData()` (or the equivalent
// `themeData` prop on DotLottieReact). The hook re-builds the JSON on
// system-theme flip + on any `class` / `data-theme` mutation of the
// document element, so manual theme toggles stay in sync too.
//
// Slot ids are a stable contract with designers. Assets that don't
// declare a given slot ignore the rule — safe to over-supply.

import { useEffect, useState } from 'react';

type ColorRGB = readonly [number, number, number];

interface ThemeColorRule {
  id: string;
  type: 'Color';
  value: ColorRGB;
}

interface BrandThemeJson {
  rules: ReadonlyArray<ThemeColorRule>;
}

const BRAND_SLOT_MAP: Readonly<Record<string, string>> = {
  // Brand axis
  slot_brand_primary: '--color-accent',
  slot_brand_secondary: '--color-llm-accent',
  slot_brand_neutral: '--color-text',
  slot_brand_bg: '--color-bg-l0',

  // Text + bg fallbacks (assets often use these directly)
  slot_text: '--color-text',
  slot_text_muted: '--color-text-muted',
  slot_bg: '--color-bg-l0',

  // Keycap palette — five colors keyed by keycap_color manifest field
  slot_keycap_cobalt: '--keycap-cobalt',
  slot_keycap_amber: '--keycap-amber',
  slot_keycap_jade: '--keycap-jade',
  slot_keycap_platinum: '--keycap-platinum',
  slot_keycap_graphite: '--keycap-graphite',

  // Status palette — for state-driven keycap output
  slot_status_success: '--color-success',
  slot_status_warning: '--color-warning',
  slot_status_danger: '--color-danger',
  slot_status_info: '--color-info',
};

// Browser resolves OKLCh / hex / var() to a concrete rgb()/rgba() at
// computed-style time. The probe element trick sidesteps hand-rolled
// OKLCh → sRGB math (which CTRL tokens use heavily).
const resolveCssColor = (cssVar: string): ColorRGB | null => {
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${cssVar});`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const match = computed.match(
    /rgba?\s*\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/,
  );
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r / 255, g / 255, b / 255] as const;
};

const buildBrandTheme = (): BrandThemeJson => {
  const rules: ThemeColorRule[] = [];
  for (const [slot, cssVar] of Object.entries(BRAND_SLOT_MAP)) {
    const value = resolveCssColor(cssVar);
    if (value) rules.push({ id: slot, type: 'Color', value });
  }
  return { rules };
};

export const useBrandThemeData = (enabled: boolean): string | null => {
  const [json, setJson] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setJson(null);
      return;
    }
    const compute = (): void => {
      setJson(JSON.stringify(buildBrandTheme()));
    };
    compute();
    const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
    mqDark.addEventListener('change', compute);
    const observer = new MutationObserver(compute);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => {
      mqDark.removeEventListener('change', compute);
      observer.disconnect();
    };
  }, [enabled]);
  return json;
};
