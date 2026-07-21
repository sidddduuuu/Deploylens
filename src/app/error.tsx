"use client";

export default function ErrorBoundary({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <main className="error-page">
      <section aria-labelledby="error-title" className="error-panel" role="alert">
        <p className="eyebrow">Investigation interrupted</p>
        <h1 id="error-title">DeployLens could not render this incident.</h1>
        <p>Retry the evidence view. If the problem continues, the incident data needs attention.</p>
        <button className="primary-button" onClick={reset} type="button">
          Retry investigation
        </button>
      </section>
    </main>
  );
}
