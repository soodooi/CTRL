// /irisy — placeholder route. Real Irisy creator UI lives on lane-B
// (H-2026-05-18-001), merges via separate PR. This stub exists only to
// unblock the build chain after revert a348fd9 deleted the file but not
// the import from app.tsx.

export const IrisyRoute = (): React.ReactElement => (
  <div
    style={{
      padding: '24px',
      fontSize: '14px',
      color: 'var(--text-muted, #999)',
      lineHeight: 1.6,
    }}
  >
    <p>Irisy placeholder.</p>
    <p>The real creator UI lands when lane-B PR merges.</p>
  </div>
);
