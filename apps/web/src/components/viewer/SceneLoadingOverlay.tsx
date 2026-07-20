export function SceneLoadingOverlay({ label = 'Loading project assets…' }: { label?: string }) {
  return (
    <div className="scene-loading-overlay" role="status" aria-live="polite" aria-label={label}>
      <span className="scene-loading-overlay__throbber" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
