import { useCallback, useEffect, useState } from 'react';
import {
  bootstrapMinimax,
  getLlmSettings,
  profileHasKey,
  setLlmKey,
  type LlmProfile,
  type LlmSettings,
} from '../lib/settings';
import { isSoundEnabled, playSound, setSoundEnabled } from '../lib/sound';

interface SettingsSheetProps {
  onClose: () => void;
}

interface KeyDraft {
  profile: string;
  value: string;
  saving: boolean;
  saved: boolean;
}

export function SettingsSheet({ onClose }: SettingsSheetProps): JSX.Element {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [keyDraft, setKeyDraft] = useState<KeyDraft | null>(null);
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());

  const onToggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) {
      // Immediate audible confirmation that sound is on
      playSound('press');
    }
  }, [soundOn]);

  const refresh = useCallback(async () => {
    try {
      const s = await getLlmSettings();
      setSettings(s);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onBootstrapMinimax = useCallback(async () => {
    setBootstrapping(true);
    try {
      const s = await bootstrapMinimax();
      setSettings(s);
      setLoadError(null);
      // Open key editor for minimax right away
      setKeyDraft({ profile: 'minimax', value: '', saving: false, saved: false });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBootstrapping(false);
    }
  }, []);

  const onEditKey = useCallback((profileName: string) => {
    setKeyDraft({ profile: profileName, value: '', saving: false, saved: false });
  }, []);

  const onSaveKey = useCallback(async () => {
    if (!keyDraft) return;
    if (!keyDraft.value.trim()) return;
    setKeyDraft({ ...keyDraft, saving: true });
    try {
      await setLlmKey(keyDraft.profile, keyDraft.value.trim());
      setKeyDraft({ ...keyDraft, saving: false, saved: true, value: '' });
      window.setTimeout(() => setKeyDraft(null), 1200);
      void refresh();
    } catch (err) {
      setKeyDraft({ ...keyDraft, saving: false });
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [keyDraft, refresh]);

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2 className="sheet-title">设置</h2>
          <button
            type="button"
            className="panel-close"
            aria-label="关闭"
            title="Esc 关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <section className="sheet-section">
          <header className="sheet-section-header">
            <h3 className="sheet-section-title">LLM 配置</h3>
            <p className="sheet-section-hint">AI 工具需要至少一个有效的 LLM profile。</p>
          </header>

          {loadError && <div className="sheet-error">{loadError}</div>}

          {settings && settings.profiles.length === 0 && (
            <div className="sheet-empty">
              <p>还没有 LLM profile。一键添加 MiniMax(国内推荐),或手动配置其他厂商。</p>
              <button
                type="button"
                className="action-btn primary"
                disabled={bootstrapping}
                onClick={onBootstrapMinimax}
              >
                {bootstrapping ? '添加中…' : '+ 一键添加 MiniMax'}
              </button>
            </div>
          )}

          {settings && settings.profiles.length > 0 && (
            <ul className="profile-list">
              {settings.profiles.map((p) => (
                <ProfileRow
                  key={p.name}
                  profile={p}
                  isDefault={settings.default_profile === p.name}
                  onEditKey={() => onEditKey(p.name)}
                />
              ))}
            </ul>
          )}

          {settings && settings.profiles.length > 0 &&
            !settings.profiles.some((p) => p.name === 'minimax') && (
              <button
                type="button"
                className="action-btn"
                disabled={bootstrapping}
                onClick={onBootstrapMinimax}
                style={{ marginTop: 10 }}
              >
                {bootstrapping ? '添加中…' : '+ 添加 MiniMax'}
              </button>
            )}
        </section>

        <section className="sheet-section">
          <header className="sheet-section-header">
            <h3 className="sheet-section-title">声音反馈</h3>
            <p className="sheet-section-hint">合成的机械键盘按下声 + AI 完成提示音。默认关。</p>
          </header>
          <label className="toggle-row">
            <span className="toggle-label">启用声音</span>
            <input
              type="checkbox"
              checked={soundOn}
              onChange={onToggleSound}
              className="toggle-checkbox"
            />
            <span className="toggle-slider" aria-hidden />
          </label>
        </section>

        {keyDraft && (
          <section className="sheet-section">
            <header className="sheet-section-header">
              <h3 className="sheet-section-title">{keyDraft.profile} · 输入 API Key</h3>
              <p className="sheet-section-hint">Key 写入 macOS Keychain,不进 git。</p>
            </header>
            <div className="key-input-row">
              <input
                type="password"
                className="key-input"
                placeholder="sk-..."
                value={keyDraft.value}
                spellCheck={false}
                autoFocus
                onChange={(e) =>
                  setKeyDraft({ ...keyDraft, value: e.target.value, saved: false })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void onSaveKey();
                  }
                }}
              />
              <button
                type="button"
                className="action-btn primary"
                disabled={keyDraft.saving || !keyDraft.value.trim()}
                onClick={onSaveKey}
              >
                {keyDraft.saving ? '保存中…' : keyDraft.saved ? '已保存 ✓' : '保存'}
              </button>
              <button
                type="button"
                className="action-btn ghost"
                onClick={() => setKeyDraft(null)}
              >
                取消
              </button>
            </div>
          </section>
        )}

        <footer className="sheet-footer mono">
          按 <kbd className="action-kbd mono">Esc</kbd> 关闭设置
        </footer>
      </div>
    </div>
  );
}

interface ProfileRowProps {
  profile: LlmProfile;
  isDefault: boolean;
  onEditKey: () => void;
}

function ProfileRow({ profile, isDefault, onEditKey }: ProfileRowProps): JSX.Element {
  const hasKey = profileHasKey(profile);
  return (
    <li className="profile-row">
      <div className="profile-row-main">
        <span className="profile-name">{profile.name}</span>
        {isDefault && <span className="profile-badge">默认</span>}
        <span className="profile-kind mono">{profile.kind}</span>
      </div>
      <div className="profile-row-meta mono">
        {profile.base_url} · {profile.default_model}
      </div>
      <div className="profile-row-actions">
        <span className={`profile-key-status ${hasKey ? 'has-key' : 'no-key'}`}>
          {hasKey ? '✓ key 已配置(明文)' : '· key 在 Keychain 或缺失'}
        </span>
        <button type="button" className="action-btn" onClick={onEditKey}>
          {hasKey ? '更新 key' : '设置 key'}
        </button>
      </div>
    </li>
  );
}
