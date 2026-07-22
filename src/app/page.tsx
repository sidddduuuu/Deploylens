import Link from "next/link";

import { incidentFixture } from "../features/investigation/fixture.ts";
import { IncidentPreview } from "../features/investigation/incident-preview.tsx";

const repositoryUrl = "https://github.com/sidddduuuu/Deploylens";

const progress = [
  "Question received",
  "Evidence gathered",
  "Cause identified",
  "Incident validated",
] as const;

const evidence = [
  {
    description: "See the exact minute the regression begins and how recovery follows.",
    label: "Timeline",
    marker: "circle",
  },
  {
    description: "Locate the checkout stage where healthy traffic starts to disappear.",
    label: "Funnel",
    marker: "circle",
  },
  {
    description: "Pinpoint the version, region, and device carrying the change.",
    label: "Segments",
    marker: "circle",
  },
  {
    description: "Connect the regression to the release that introduced it.",
    label: "Deployment",
    marker: "diamond",
  },
] as const;

const workflow = [
  {
    description: "Ask about a metric change in the language your team already uses.",
    label: "Ask one focused question",
  },
  {
    description: "DeployLens runs the linked timeline, funnel, segment, and release analysis.",
    label: "Follow the evidence",
  },
  {
    description: "Review one validated incident, then narrow it without losing context.",
    label: "Act with confidence",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="landing-page">
      <header className="landing-site-header">
        <div className="landing-nav landing-container">
          <Link aria-label="DeployLens home" className="landing-brand" href="/">
            <span aria-hidden="true" className="landing-brand-mark">D</span>
            <span className="landing-brand-text">DeployLens</span>
          </Link>
          <nav aria-label="Primary navigation" className="landing-nav-links">
            <a href="#how-it-works">How it works</a>
            <a href="#evidence">Evidence</a>
            <a href={repositoryUrl}>GitHub</a>
          </nav>
          <Link className="landing-nav-cta" href="/app">Open DeployLens</Link>
        </div>
      </header>
      <main>
      <section aria-labelledby="hero-title" className="landing-hero">
        <div className="landing-hero-copy landing-container">
          <p className="landing-kicker">Evidence-first incident investigation</p>
          <h1 id="hero-title">
            Ask why the metric moved.{" "}
            <span>Get the incident, not a paragraph.</span>
          </h1>
          <p className="landing-lede">
            DeployLens connects timelines, funnel changes, deployments, and affected segments
            into one validated incident.
          </p>
          <div className="landing-actions">
            <Link className="landing-button landing-button-primary" href="/app">
              Investigate an incident <span aria-hidden="true">→</span>
            </Link>
            <a className="landing-button landing-button-secondary" href="#evidence">
              See the evidence
            </a>
          </div>
          <ol aria-label="Example investigation progress" className="landing-progress">
            {progress.map((label) => (
              <li key={label}><span aria-hidden="true">✓</span>{label}</li>
            ))}
          </ol>
        </div>

        <div className="landing-container landing-product-shell">
          <div className="landing-question">
            <span aria-hidden="true" className="landing-question-mark">D</span>
            <p>
              <span>Example investigation</span>
              <strong>Why did checkout conversion drop around 14:20?</strong>
            </p>
            <Link aria-label="Open this investigation in DeployLens" href="/app">→</Link>
          </div>
          <div className="landing-product-stage">
            <IncidentPreview incident={incidentFixture} />
          </div>
        </div>
      </section>

      <section aria-labelledby="evidence-title" className="landing-section landing-evidence" id="evidence">
        <div className="landing-container">
          <div className="landing-section-intro">
            <h2 id="evidence-title">One continuous evidence chain.</h2>
            <p>
              Select a segment in the interactive preview. The finding, timeline, funnel, and current
              evidence all update together.
            </p>
          </div>
          <ol className="landing-evidence-chain">
            {evidence.map(({ description, label, marker }) => (
              <li key={label}>
                <span aria-hidden="true" className={`landing-trace-marker landing-trace-${marker}`} />
                <h3>{label}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="workflow-title" className="landing-section landing-workflow" id="how-it-works">
        <div className="landing-container">
          <div className="landing-section-intro landing-section-intro-wide">
            <h2 id="workflow-title">From question to root cause in three steps.</h2>
            <p>Enough structure to be trusted. Little enough ceremony to use during an incident.</p>
          </div>
          <ol className="landing-workflow-list">
            {workflow.map(({ description, label }, index) => (
              <li key={label}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{label}</h3><p>{description}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="reliability-title" className="landing-reliability">
        <div className="landing-container landing-reliability-grid">
          <div>
            <h2 id="reliability-title">Evidence has to earn the conclusion.</h2>
            <p>
              DeployLens never invents a cause or hides the path behind it. Every claim remains
              attached to visible, query-backed evidence.
            </p>
          </div>
          <dl>
            <div><dt>Query</dt><dd>Real ClickHouse analysis</dd></div>
            <div><dt>Orchestrate</dt><dd>Durable Trigger.dev tasks</dd></div>
            <div><dt>Validate</dt><dd>Schema-checked before render</dd></div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="final-cta-title" className="landing-final-cta">
        <div className="landing-container">
          <h2 id="final-cta-title">Stop stitching incidents together by hand.</h2>
          <div className="landing-actions landing-actions-dark">
            <Link className="landing-button landing-button-dark" href="/app">Open DeployLens</Link>
            <a className="landing-source-link" href={repositoryUrl}>View the source →</a>
          </div>
        </div>
      </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-grid">
          <Link className="landing-footer-brand" href="/">DeployLens</Link>
          <nav aria-label="Footer navigation">
            <a href={repositoryUrl}>GitHub</a>
            <a href={`${repositoryUrl}#readme`}>Documentation</a>
          </nav>
          <p>
            Keep deployments access-protected until product authentication and rate limiting
            are configured.
          </p>
        </div>
      </footer>
    </div>
  );
}
