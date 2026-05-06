import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function PermissionGuide(): JSX.Element | null {
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<boolean>('check_accessibility').then((g) => {
      if (!cancelled) setGranted(g);
    });
    const tick = setInterval(async () => {
      const g = await invoke<boolean>('check_accessibility');
      if (!cancelled) setGranted(g);
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, []);

  if (granted === null || granted === true) return null;

  return (
    <div className="permission-guide">
      <div className="permission-card">
        <h2>需要辅助功能权限</h2>
        <p>CTRL 需要监听全局键盘以响应 Control 键唤出。</p>
        <button onClick={() => invoke('open_accessibility_settings')}>
          打开系统设置
        </button>
        <p className="hint">授权后请重启 CTRL</p>
      </div>
    </div>
  );
}
