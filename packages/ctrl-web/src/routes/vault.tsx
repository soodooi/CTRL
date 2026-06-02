// /vault — retired route per ADR-002 substrate § vault v1 §8.7
// (2026-06-01, memory `decision_vault_adr_002_section_8`).
//
// The L1 Vault chip + L2VaultPanel + workspace `vault-md` tab pattern
// replaced the 3-pane VaultBrowser shell. This file stays as a no-op
// landing so existing /vault navigations (tray events, keycap deep
// links) don't 404 — visiting the URL activates the L1 rail and the
// L2 panel appears via the shell's rail-driven conditional mount.

import { useEffect, type ReactElement } from 'react';
import { useRail, VAULT_RAIL_ID } from '@/components/PrimaryRail';

export const VaultRoute = (): ReactElement => {
  const { setActiveRailId } = useRail();
  useEffect(() => {
    setActiveRailId(VAULT_RAIL_ID);
  }, [setActiveRailId]);
  return <></>;
};
