// Persistent production shell: Work, Library, Settings, with resident Irisy.
// Business scenes and pack-specific navigation are intentionally absent.
// (ADR-003 frontend §8.5 v40)

import { useCallback, useEffect, type ReactElement } from 'react';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { AmbientHome } from './AmbientHome';
import type { SidebarSection } from './Sidebar';
import { useActiveProvider, formatProviderLabel } from '@/hooks/useActiveProvider';
import { useKernelStatus } from '@/hooks/useKernelStatus';
import { invoke, platform } from '@/lib/bridge';
import { isSeedingFirstRun } from '@/lib/kernel';
import { initKernelPackEventListener } from '@/lib/feature-pack';
import styles from './AmbientHome.module.css';

export function AmbientWorkbench(): ReactElement {
  return <CanonicalWorkbench />;
}

function CanonicalWorkbench(): ReactElement {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const section: SidebarSection = pathname === '/library'
    ? 'library'
    : pathname.startsWith('/settings')
      ? 'settings'
      : 'work';
  const { active: activeProvider } = useActiveProvider();
  const modelLabel = formatProviderLabel(activeProvider);
  const settingUp = isSeedingFirstRun(useKernelStatus());

  const onSidebarSelect = useCallback((next: SidebarSection): void => {
    const to = next === 'work' ? '/' : next === 'library' ? '/library' : '/settings';
    void navigate({ to });
  }, [navigate]);

  const hideLauncher = useCallback((): void => {
    if (platform() !== 'tauri') return;
    void invoke<void>('hide_window').catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) hideLauncher();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hideLauncher]);

  // Keep Library's installed input synchronized with kernel-side installs.
  // This listener refreshes registry state only; it never opens a pack scene.
  // (ADR-003 frontend §8.5 v40)
  useEffect(() => initKernelPackEventListener(), []);

  return (
    <div className={styles.workbench} data-testid="shell">
      <AmbientHome
        section={section}
        modelLabel={modelLabel}
        onOpenProviderSettings={() => void navigate({ to: '/settings/providers' })}
        onHideLauncher={hideLauncher}
        workspaceContent={section === 'settings' ? <Outlet /> : undefined}
        onSidebarSelect={onSidebarSelect}
        settingUp={settingUp}
      />
    </div>
  );
}
