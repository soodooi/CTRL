// Coding route — opencode driven over ACP, over a selectable workspace. The
// same scene is used by the routed page and AmbientHome so there is one
// Coding interaction model (note: this standalone route has no sidebar entry
// and renders without Irisy — the Sidebar's Coding entry opens the
// Ambient-embedded scene, where Irisy is always resident).
// (ADR-001 spine §4 v16; ADR-003 frontend §8.5 v32;
// ADR-005 irisy §8.7 v30)

import type { ReactElement } from 'react';
import { CodingScene } from '@/components/coding/CodingScene';

export const CodingRoute = (): ReactElement => <CodingScene />;
