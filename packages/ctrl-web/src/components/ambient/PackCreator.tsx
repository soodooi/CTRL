// PackCreator — the "create one" flow: describe a tool → Irisy drafts a pack →
// EVALS (validate through the gate) → review/edit → install. No JSON by hand
// unless you want it (ADR-002 § composition §7.3 + §7.4/§7.5 evals). The evals
// step (mcp_pack_validate) is what stops a broken pack from shipping — the brain
// (or the user) self-corrects from structured issues before install.

import { useState, type ReactElement } from 'react';
import { generatePack, draftToManifest, type DraftPack } from '@/lib/feature-pack-create';
import { installPack, scaffoldFromOpenApi } from '@/lib/feature-pack';
import { validatePack, type PackValidationReport } from '@/lib/kernel';
import { PackEvals } from './PackEvals';
import styles from './PackCreator.module.css';

interface Props {
  onClose: () => void;
  onInstalled: () => void;
}

export function PackCreator({ onClose, onInstalled }: Props): ReactElement {
  const [desc, setDesc] = useState('');
  const [draft, setDraft] = useState<DraftPack | null>(null);
  const [generating, setGenerating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PackValidationReport | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [json, setJson] = useState('');
  const [openapiText, setOpenapiText] = useState('');
  const [openapiPath, setOpenapiPath] = useState('');
  const [scaffolding, setScaffolding] = useState(false);
  const [scaffoldNotes, setScaffoldNotes] = useState<string[]>([]);

  // The manifest to install/validate: the edited JSON when editing, else the
  // draft's. Throws on invalid JSON so the caller surfaces a parse error.
  const currentManifest = (): Record<string, unknown> => {
    if (editMode) return JSON.parse(json) as Record<string, unknown>;
    if (!draft) throw new Error('no draft');
    return draftToManifest(draft) as unknown as Record<string, unknown>;
  };

  const evaluate = async (manifest: unknown): Promise<PackValidationReport | null> => {
    try {
      const r = await validatePack(manifest);
      setReport(r);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const generate = async (): Promise<void> => {
    setGenerating(true);
    setError(null);
    setDraft(null);
    setReport(null);
    setEditMode(false);
    try {
      const d = await generatePack(desc.trim());
      setDraft(d);
      const manifest = draftToManifest(d);
      setJson(JSON.stringify(manifest, null, 2));
      await evaluate(manifest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  // Scaffold a §14 connector from an OpenAPI spec (AutoMCP): draft a record_source
  // via the gate, wrap it in a manifest, drop into the JSON editor + evals.
  const scaffold = async (): Promise<void> => {
    setScaffolding(true);
    setError(null);
    setScaffoldNotes([]);
    try {
      const spec = JSON.parse(openapiText) as unknown;
      const out = await scaffoldFromOpenApi(spec, openapiPath.trim());
      const manifest = {
        manifest_version: 2,
        id: 'ctrl-new-connector',
        name: 'New connector',
        record_source: out.record_source,
        actions: [{ id: 'view', name: 'View records' }],
      };
      setJson(JSON.stringify(manifest, null, 2));
      setScaffoldNotes(out.notes);
      setEditMode(true);
      await evaluate(manifest);
    } catch (e) {
      setError(
        openapiText.trim() === '' || openapiPath.trim() === ''
          ? 'paste an OpenAPI spec and a path first'
          : `scaffold failed — ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setScaffolding(false);
    }
  };

  // Re-run the evals over the current (possibly hand-edited) manifest.
  const recheck = async (): Promise<void> => {
    setError(null);
    try {
      await evaluate(currentManifest());
    } catch (e) {
      setError(`invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
      setReport(null);
    }
  };

  const install = async (): Promise<void> => {
    setInstalling(true);
    setError(null);
    try {
      const manifest = currentManifest();
      // Gate the install on the evals — never ship a pack with errors. Fail
      // CLOSED: if the evals couldn't run (kernel unreachable → null report),
      // block install rather than shipping an un-evaluated pack (`evaluate`
      // already surfaced the error).
      const r = await evaluate(manifest);
      if (r == null || !r.ok) {
        setInstalling(false);
        return;
      }
      await installPack(manifest);
      onInstalled();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalling(false);
    }
  };

  const blocked = report != null && !report.ok;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}>✦ Create a feature pack</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className={styles.sub}>
          Describe a tool — Irisy drafts it, the gate checks it, you review and install.
        </p>
        <textarea
          className={styles.input}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={'e.g. "show my largest folders" or "which ports are listening"'}
          rows={3}
          disabled={generating}
        />
        {draft == null && !editMode && (
          <>
            <button
              type="button"
              className={styles.primary}
              disabled={!desc.trim() || generating}
              onClick={() => void generate()}
            >
              {generating ? 'Drafting…' : 'Generate'}
            </button>
            <details className={styles.openapi}>
              <summary>or scaffold a connector from an OpenAPI spec</summary>
              <input
                className={styles.input}
                value={openapiPath}
                onChange={(e) => setOpenapiPath(e.target.value)}
                placeholder="read path, e.g. /api/v1/portfolio/holdings"
                disabled={scaffolding}
              />
              <textarea
                className={styles.jsonEditor}
                value={openapiText}
                onChange={(e) => setOpenapiText(e.target.value)}
                placeholder="paste the OpenAPI 3 JSON spec"
                spellCheck={false}
                rows={5}
                disabled={scaffolding}
                aria-label="OpenAPI spec JSON"
              />
              <button
                type="button"
                className={styles.secondary}
                disabled={scaffolding || !openapiText.trim() || !openapiPath.trim()}
                onClick={() => void scaffold()}
              >
                {scaffolding ? 'Scaffolding…' : 'Scaffold from OpenAPI'}
              </button>
            </details>
          </>
        )}
        {(draft != null || editMode) && (
          <div className={styles.review}>
            {!editMode && draft != null ? (
              <>
                <div className={styles.reviewHead}>
                  <span className={styles.reviewIcon}>{draft.icon}</span>
                  <div>
                    <div className={styles.reviewName}>{draft.name}</div>
                    <div className={styles.reviewSummary}>{draft.summary}</div>
                  </div>
                </div>
                <div className={styles.actions}>
                  {draft.actions.map((a) => (
                    <div key={a.id} className={styles.action}>
                      <span className={styles.actionName}>{a.name}</span>
                      <code className={styles.actionCmd}>{a.command}</code>
                    </div>
                  ))}
                </div>
                {draft.knowledge_base != null && draft.knowledge_base !== '' && (
                  <div className={styles.reviewSummary}>Data → {draft.knowledge_base}/</div>
                )}
                {draft.secrets != null && draft.secrets.length > 0 && (
                  <div className={styles.reviewSummary}>
                    Needs after install: {draft.secrets.map((s) => s.label).join(', ')}
                  </div>
                )}
              </>
            ) : (
              <textarea
                className={styles.jsonEditor}
                value={json}
                onChange={(e) => setJson(e.target.value)}
                spellCheck={false}
                rows={12}
                aria-label="Pack manifest JSON"
              />
            )}

            {/* Evals result — errors block install, warnings are advisory. */}
            {/* Spec-repair notes from an OpenAPI scaffold — what to refine. */}
            {scaffoldNotes.length > 0 && (
              <ul className={styles.notes}>
                {scaffoldNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}

            {report != null && <PackEvals report={report} />}

            <div className={styles.reviewBtns}>
              {/* Toggle back to the review card only when there IS a draft (an
                  OpenAPI scaffold has no NL draft — it stays in the editor). */}
              {draft != null && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setEditMode((v) => !v);
                    setError(null);
                  }}
                  disabled={installing}
                  title={editMode ? 'Back to the review card' : 'Edit the pack JSON by hand'}
                >
                  {editMode ? 'Done editing' : 'Edit JSON'}
                </button>
              )}
              {editMode && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void recheck()}
                  disabled={installing}
                >
                  Re-check
                </button>
              )}
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  try {
                    void navigator.clipboard?.writeText(JSON.stringify(currentManifest(), null, 2));
                  } catch {
                    /* invalid JSON while editing — nothing to copy */
                  }
                }}
                disabled={installing}
                title="Copy the pack JSON to share with someone"
              >
                Copy
              </button>
              {draft != null && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void generate()}
                  disabled={generating || installing}
                >
                  Regenerate
                </button>
              )}
              <button
                type="button"
                className={styles.primary}
                onClick={() => void install()}
                disabled={installing || blocked}
                title={blocked ? 'Fix the errors above before installing' : 'Install this pack'}
              >
                {installing ? 'Installing…' : blocked ? 'Fix errors to install' : 'Install'}
              </button>
            </div>
          </div>
        )}
        {error != null && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
