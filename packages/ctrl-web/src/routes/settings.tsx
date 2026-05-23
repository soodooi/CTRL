// /settings — first L3 manifest-driven route.
//
// The page used to be hand-written JSX. The same layout is now a JSON
// literal that <ManifestRenderer> walks. Everything visual comes from
// registered L1 primitives (Stack / Heading / Text).
//
// This is the test bed for the L3 layer model. Keycap authors (and
// the Irisy keycap-creator) will ship the same shape of JSON to
// describe a keycap's workspace UI without writing React.

import type { ReactElement } from 'react';
import {
  ManifestRenderer,
  type WorkspaceLayout,
} from '@/components/manifest';
import styles from './settings.module.css';

const SETTINGS_LAYOUT: WorkspaceLayout = {
  version: 1,
  root: {
    component: 'Stack',
    props: { padX: 6, padY: 6, gap: 5 },
    children: [
      { component: 'Heading', props: { level: 1 }, children: ['Settings'] },

      // About — version + auto-update + changelog. First section so users
      // see the build they're on without scrolling.
      { component: 'AboutPanel' },

      {
        component: 'Stack',
        props: { gap: 2 },
        children: [
          { component: 'Heading', props: { level: 4 }, children: ['Marketplace'] },
          {
            component: 'Text',
            props: { tone: 'soft' },
            children: ['Install keycaps from 10,000+ MCP servers in one click.'],
          },
        ],
      },

      {
        component: 'Stack',
        props: { gap: 2 },
        children: [
          { component: 'Heading', props: { level: 4 }, children: ['BYOK'] },
          {
            component: 'Text',
            props: { tone: 'soft' },
            children: [
              'Bring your own AI key (Volc / Anthropic / OpenAI / Ollama) for higher-quality creator flows. Stored in OS keychain — never crosses the network from this device.',
            ],
          },
        ],
      },

      {
        component: 'Stack',
        props: { gap: 2 },
        children: [
          { component: 'Heading', props: { level: 4 }, children: ['Layer model'] },
          {
            component: 'Text',
            props: { tone: 'soft' },
            children: [
              'This page is rendered by ManifestRenderer from a JSON layout — the L3 piece of the cockpit layer model. Same renderer will eat keycap manifests.',
            ],
          },
        ],
      },
    ],
  },
};

export const SettingsRoute = (): ReactElement => (
  <div className={styles.layout}>
    <main className={styles.main} role="main">
      <ManifestRenderer layout={SETTINGS_LAYOUT} />
    </main>
  </div>
);
