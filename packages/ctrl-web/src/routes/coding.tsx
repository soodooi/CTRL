// Coding route — kept as a full-screen fallback. The primary path renders
// CodingTerminal as a scene inside AmbientHome's left work area (so Irisy
// stays resident in the right column). See components/coding/CodingTerminal.

import type { ReactElement } from 'react';
import { CodingTerminal } from '@/components/coding/CodingTerminal';

export const CodingRoute = (): ReactElement => <CodingTerminal />;
