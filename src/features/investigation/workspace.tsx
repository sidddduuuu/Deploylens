"use client";

import { useState, type FormEvent } from "react";

import { supportsFixtureQuestion } from "./fixture-question.ts";
import type { IncidentResult } from "./schema.ts";

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: "UTC",
});

function formatPercent(rate: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(rate);
}

function Conversation({ incident, question }: Readonly<{ incident: IncidentResult; question: string }>) {
  return (
    <ol aria-live="polite" className="conversation">
      <li className="message message-user">
        <span>You</span>
        <p>{question}</p>
      </li>
      <li className="message message-system">
        <span>DeployLens · fixture</span>
        <p>{incident.finding.headline}</p>
      </li>
    </ol>
  );
}

function Composer({ initialQuestion, onSubmit }: Readonly<{
  initialQuestion: string;
  onSubmit: (question: string) => void;
}>) {
  const [draft, setDraft] = useState(initialQuestion);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!supportsFixtureQuestion(question, initialQuestion)) {
      setError("Layer 2 supports the seeded checkout question only.");
      return;
    }
    setError(null);
    onSubmit(question);
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="incident-question">Ask about checkout</label>
      <textarea
        aria-describedby={`question-help${error ? " question-error" : ""}`}
        aria-invalid={error !== null}
        id="incident-question"
        maxLength={500}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        required
        rows={3}
        value={draft}
      />
      <p className="composer-help" id="question-help">Fixture mode accepts one deterministic prompt.</p>
      {error ? <p className="composer-error" id="question-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit">Run fixture</button>
    </form>
  );
}

function EvidenceMetrics({ view }: Readonly<{ view: IncidentResult["views"][number] }>) {
  const baselineStart = view.funnel.baseline[0]!.sessions;
  const baseline = view.funnel.baseline.at(-1)!;
  const incidentStart = view.funnel.incident[0]!.sessions;
  const incident = view.funnel.incident.at(-1)!;
  const baselineConversion = baselineStart === 0 ? 0 : baseline.sessions / baselineStart;
  const incidentConversion = incidentStart === 0 ? 0 : incident.sessions / incidentStart;
  const peakLatency = Math.max(...view.timeline.map(({ p95LatencyMs }) => p95LatencyMs));
  const relativeChange = baselineConversion === 0
    ? 0
    : incidentConversion / baselineConversion - 1;

  return (
    <dl className="metrics">
      <div><dt>Baseline conversion</dt><dd>{formatPercent(baselineConversion)}</dd></div>
      <div><dt>Incident conversion</dt><dd>{formatPercent(incidentConversion)}</dd></div>
      <div><dt>Relative change</dt><dd className={relativeChange < 0 ? "negative" : undefined}>{formatPercent(relativeChange)}</dd></div>
      <div><dt>Peak p95 latency</dt><dd>{peakLatency.toFixed(0)} ms</dd></div>
    </dl>
  );
}

function IncidentMarkers({ incident }: Readonly<{ incident: IncidentResult }>) {
  return (
    <section aria-labelledby="sequence-title" className="sequence">
      <div className="section-heading">
        <p className="eyebrow">Correlated sequence</p>
        <h2 id="sequence-title">Deploy, impact, recovery</h2>
      </div>
      <ol className="markers">
        {incident.markers.map((marker) => (
          <li key={`${marker.kind}-${marker.at}`}>
            <span aria-hidden="true" className="marker-dot" />
            <time dateTime={marker.at}>{timeFormatter.format(new Date(marker.at))} UTC</time>
            <strong>{marker.label}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ViewControls({ incident, selectedViewId, onSelect }: Readonly<{
  incident: IncidentResult;
  selectedViewId: string;
  onSelect: (viewId: string) => void;
}>) {
  const affected = incident.segments.find(({ segment }) =>
    segment.version === incident.finding.affectedSegment.version &&
    segment.region === incident.finding.affectedSegment.region &&
    segment.device === incident.finding.affectedSegment.device,
  );
  const viewIds = new Set([incident.defaultViewId, affected?.viewId]);
  const views = incident.views.filter(({ id }) => viewIds.has(id));

  return (
    <div aria-label="Evidence view" className="view-controls" role="group">
      {views.map((view) => (
        <button
          aria-pressed={selectedViewId === view.id}
          key={view.id}
          onClick={() => onSelect(view.id)}
          type="button"
        >
          {view.id === incident.defaultViewId ? "All traffic" : "Affected segment"}
        </button>
      ))}
    </div>
  );
}

function IncidentEvidence({ incident, selectedViewId, onSelect }: Readonly<{
  incident: IncidentResult;
  selectedViewId: string;
  onSelect: (viewId: string) => void;
}>) {
  const view = incident.views.find(({ id }) => id === selectedViewId)
    ?? incident.views.find(({ id }) => id === incident.defaultViewId)!;

  return (
    <section aria-labelledby="finding-title" className="evidence-pane">
      <header className="evidence-header">
        <div>
          <p className="eyebrow">Incident {incident.incidentId}</p>
          <h2 id="finding-title">{incident.finding.headline}</h2>
        </div>
        <span className="confidence">{incident.finding.confidence} confidence</span>
      </header>
      <div className="evidence-toolbar">
        <div><span>Current evidence</span><strong aria-live="polite">{view.label}</strong></div>
        <ViewControls incident={incident} onSelect={onSelect} selectedViewId={selectedViewId} />
      </div>
      <EvidenceMetrics view={view} />
      <IncidentMarkers incident={incident} />
      <footer className="evidence-footer">
        <span>24 segments scanned</span>
        <span>Release {incident.finding.cause.version}</span>
        <span>Commit {incident.finding.cause.commitSha}</span>
      </footer>
    </section>
  );
}

export function InvestigationWorkspace({ incident }: Readonly<{ incident: IncidentResult }>) {
  const [question, setQuestion] = useState(incident.question);
  const [selectedViewId, setSelectedViewId] = useState(incident.defaultViewId);

  function runFixture(nextQuestion: string) {
    setQuestion(nextQuestion);
    setSelectedViewId(incident.defaultViewId);
  }

  return (
    <div className="workspace">
      <aside aria-labelledby="conversation-title" className="chat-rail">
        <div className="chat-heading">
          <p className="eyebrow">Investigation</p>
          <h1 id="conversation-title">Checkout conversion</h1>
          <p>Ask one question. The evidence stays linked as you narrow the incident.</p>
        </div>
        <Conversation incident={incident} question={question} />
        <Composer initialQuestion={incident.question} onSubmit={runFixture} />
      </aside>
      <IncidentEvidence incident={incident} onSelect={setSelectedViewId} selectedViewId={selectedViewId} />
    </div>
  );
}
