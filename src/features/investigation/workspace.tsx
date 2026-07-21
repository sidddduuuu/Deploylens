"use client";

import { useChat } from "@ai-sdk/react";
import {
  useTriggerChatTransport,
  type InferChatUIMessage,
} from "@trigger.dev/sdk/chat/react";
import { useState, type FormEvent } from "react";

import type {
  ChatAccessToken,
  StartChatSessionResult,
} from "../../app/actions.ts";
import type { deploylensAgent } from "../../trigger/deploylens.ts";
import {
  incidentResultSchema,
  investigationProgressSchema,
  type IncidentResult,
  type InvestigationProgress,
} from "./schema.ts";

type DeployLensMessage = InferChatUIMessage<typeof deploylensAgent>;

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

function latestAssistant(messages: readonly DeployLensMessage[]) {
  return messages.findLast(({ role }) => role === "assistant");
}

function incidentFromMessages(messages: readonly DeployLensMessage[]) {
  for (const message of messages.toReversed()) {
    for (const part of message.parts.toReversed()) {
      if (part.type !== "tool-investigateIncident" || part.state !== "output-available") continue;
      const parsed = incidentResultSchema.safeParse(part.output);
      if (parsed.success) return parsed.data;
    }
  }
}

function progressFromMessages(messages: readonly DeployLensMessage[]) {
  const assistant = latestAssistant(messages);
  if (!assistant) return [];

  return assistant.parts.flatMap((part) => {
    if (part.type !== "data-progress") return [];
    const parsed = investigationProgressSchema.safeParse(part.data);
    return parsed.success ? [parsed.data] : [];
  });
}

function Conversation({ messages, progress, error }: Readonly<{
  messages: readonly DeployLensMessage[];
  progress: readonly InvestigationProgress[];
  error: Error | undefined;
}>) {
  return (
    <ol aria-live="polite" className="conversation">
      {messages.length === 0 ? (
        <li className="message message-system">
          <span>DeployLens</span>
          <p>Ready to investigate the seeded checkout incident.</p>
        </li>
      ) : null}
      {messages.map((message) => message.parts.map((part, index) => part.type === "text" ? (
        <li className={`message message-${message.role === "user" ? "user" : "system"}`} key={`${message.id}-${index}`}>
          <span>{message.role === "user" ? "You" : "DeployLens"}</span>
          <p>{part.text}</p>
        </li>
      ) : null))}
      {progress.length > 0 ? (
        <li className="message message-system progress-message">
          <span>Analysis progress</span>
          <ul className="progress-list">
            {progress.map(({ label, status }) => (
              <li key={label}>
                <span aria-hidden="true">
                  {status === "complete" ? "✓" : status === "failed" ? "×" : "·"}
                </span>
                {label}
              </li>
            ))}
          </ul>
        </li>
      ) : null}
      {error ? (
        <li className="composer-error" role="alert">
          The investigation could not complete. Check the Trigger.dev and ClickHouse configuration.
        </li>
      ) : null}
    </ol>
  );
}

function Composer({ initialQuestion, busy, onSubmit }: Readonly<{
  initialQuestion: string;
  busy: boolean;
  onSubmit: (question: string) => void;
}>) {
  const [draft, setDraft] = useState(initialQuestion);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question) {
      setError("Enter a question about checkout conversion.");
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
        disabled={busy}
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
      <p className="composer-help" id="question-help">Runs the seeded checkout investigation.</p>
      {error ? <p className="composer-error" id="question-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={busy} type="submit">
        {busy ? "Investigating…" : "Investigate"}
      </button>
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

function IncidentEvidence({ incident, selectedViewId, onSelect, preview }: Readonly<{
  incident: IncidentResult;
  selectedViewId: string;
  onSelect: (viewId: string) => void;
  preview: boolean;
}>) {
  const view = incident.views.find(({ id }) => id === selectedViewId)
    ?? incident.views.find(({ id }) => id === incident.defaultViewId)!;

  return (
    <section aria-labelledby="finding-title" className="evidence-pane">
      <header className="evidence-header">
        <div>
          <p className="eyebrow">
            {preview ? "Fixture preview" : "Live incident"} · {incident.incidentId}
          </p>
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

function EvidenceStatus({ busy, failed }: Readonly<{ busy: boolean; failed: boolean }>) {
  const title = failed
    ? "No live incident result was produced"
    : busy
      ? "Building the incident evidence"
      : "Waiting for a validated incident result";

  return (
    <section aria-live="polite" className="evidence-pane evidence-status">
      <p className="eyebrow">Live evidence</p>
      <h2>{title}</h2>
      <p>{failed
        ? "The fixture preview was removed so stale evidence is not presented as a completed analysis."
        : "The card will appear only after the streamed tool output passes validation."}</p>
    </section>
  );
}

type InvestigationWorkspaceProps = Readonly<{
  incident: IncidentResult;
  chatId: string;
  mintAccessTokenAction: () => Promise<ChatAccessToken>;
  startSessionAction: () => Promise<StartChatSessionResult>;
}>;

export function InvestigationWorkspace({
  incident,
  chatId,
  mintAccessTokenAction,
  startSessionAction,
}: InvestigationWorkspaceProps) {
  const [selectedViewId, setSelectedViewId] = useState(incident.defaultViewId);
  const transport = useTriggerChatTransport<typeof deploylensAgent>({
    task: "deploylens-agent",
    accessToken: () => mintAccessTokenAction(),
    startSession: () => startSessionAction(),
  });
  const { messages, sendMessage, status, error } = useChat<DeployLensMessage>({
    id: chatId,
    transport,
  });
  const streamedIncident = incidentFromMessages(messages);
  const currentIncident = streamedIncident ?? (messages.length === 0 ? incident : undefined);
  const progress = progressFromMessages(messages);
  const busy = status === "submitted" || status === "streaming";
  const activeViewId = currentIncident?.views.some(({ id }) => id === selectedViewId)
    ? selectedViewId
    : currentIncident?.defaultViewId;

  function investigate(question: string) {
    void sendMessage({ text: question });
  }

  return (
    <div className="workspace">
      <aside aria-labelledby="conversation-title" className="chat-rail">
        <div className="chat-heading">
          <p className="eyebrow">Investigation</p>
          <h1 id="conversation-title">Checkout conversion</h1>
          <p>Ask one question. The evidence stays linked as you narrow the incident.</p>
        </div>
        <Conversation error={error} messages={messages} progress={progress} />
        <Composer busy={busy} initialQuestion={incident.question} onSubmit={investigate} />
      </aside>
      {currentIncident && activeViewId ? (
        <IncidentEvidence
          incident={currentIncident}
          onSelect={setSelectedViewId}
          preview={!streamedIncident}
          selectedViewId={activeViewId}
        />
      ) : (
        <EvidenceStatus busy={busy} failed={Boolean(error)} />
      )}
    </div>
  );
}
