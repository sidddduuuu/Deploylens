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
import { normalizedTimelineX, segmentTone, selectIncidentView } from "./view.ts";

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

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

const countFormatter = new Intl.NumberFormat("en");

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
    <div className="conversation">
      <ol aria-live="polite" aria-relevant="additions text" className="message-log" role="log">
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
      </ol>
      {progress.length > 0 ? (
        <div aria-live="polite" className="message message-system progress-message" role="status">
          <span>Analysis progress</span>
          <ul className="progress-list">
            {progress.map(({ label, status }) => (
              <li key={label}>
                <span aria-hidden="true">
                  {status === "complete" ? "✓" : status === "failed" ? "×" : "·"}
                </span>
                {label}
                <em>{status}</em>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p aria-live="polite" className="composer-error" role="status">
          The investigation could not complete. Check the Trigger.dev and ClickHouse configuration.
        </p>
      ) : null}
    </div>
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

type IncidentView = IncidentResult["views"][number];
type SegmentDelta = IncidentResult["segments"][number];
type IncidentMarker = IncidentResult["markers"][number];
type TimelineMetric = "conversionRate" | "errorRate" | "p95LatencyMs";

function checkoutConversion(stages: IncidentView["funnel"]["baseline"]) {
  const starts = stages.find(({ key }) => key === "checkout_started")!.sessions;
  const purchases = stages.find(({ key }) => key === "purchase")!.sessions;
  return starts === 0 ? 0 : purchases / starts;
}

function EvidenceMetrics({ view }: Readonly<{ view: IncidentView }>) {
  const baselineConversion = checkoutConversion(view.funnel.baseline);
  const incidentConversion = checkoutConversion(view.funnel.incident);
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

const chartWidth = 720;
const chartLeft = 76;
const chartRight = 16;
const laneHeight = 48;

function timelineX(at: string, timeline: IncidentView["timeline"]) {
  return chartLeft + normalizedTimelineX(at, timeline) * (chartWidth - chartLeft - chartRight);
}

function metricPoints(
  timeline: IncidentView["timeline"],
  metric: TimelineMetric,
  top: number,
  ceiling: number,
) {
  return timeline.map((point) => {
    const ratio = Math.min(point[metric] / ceiling, 1);
    return `${timelineX(point.at, timeline)},${top + laneHeight * (1 - ratio)}`;
  }).join(" ");
}

function TimelineDetails({ view }: Readonly<{ view: IncidentView }>) {
  return (
    <details className="data-details">
      <summary>View timeline data</summary>
      <div aria-label="Scrollable timeline data" className="data-scroll" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Time</th><th scope="col">Conversion</th><th scope="col">Errors</th><th scope="col">p95 latency</th></tr></thead>
          <tbody>{view.timeline.map((point) => (
            <tr key={point.at}>
              <th scope="row"><time dateTime={point.at}>{timeFormatter.format(new Date(point.at))}</time></th>
              <td>{formatPercent(point.conversionRate)}</td>
              <td>{formatPercent(point.errorRate)}</td>
              <td>{countFormatter.format(point.p95LatencyMs)} ms</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

function MarkerKey({ markers }: Readonly<{ markers: readonly IncidentMarker[] }>) {
  return (
    <ul aria-label="Correlated incident events" className="marker-key">
      {markers.map((marker) => (
        <li key={`${marker.kind}-${marker.at}`}>
          <span aria-hidden="true" className={`marker-swatch marker-${marker.kind}`} />
          <time dateTime={marker.at}>{timeFormatter.format(new Date(marker.at))} UTC</time>
          <strong>{marker.label}</strong>
        </li>
      ))}
    </ul>
  );
}

function TimelineChart({ incident, view }: Readonly<{
  incident: IncidentResult;
  view: IncidentView;
}>) {
  const allPoints = incident.views.flatMap(({ timeline }) => timeline);
  const maxError = Math.max(0.1, ...allPoints.map(({ errorRate }) => errorRate));
  const maxLatency = Math.max(500, ...allPoints.map(({ p95LatencyMs }) => p95LatencyMs));
  const lanes = [
    { metric: "conversionRate", label: "Conversion 0–100%", top: 12, ceiling: 1 },
    { metric: "errorRate", label: `Errors 0–${formatPercent(maxError)}`, top: 86, ceiling: maxError },
    { metric: "p95LatencyMs", label: `p95 0–${countFormatter.format(maxLatency)} ms`, top: 160, ceiling: maxLatency },
  ] as const;
  const firstAt = view.timeline[0]!.at;
  const lastAt = view.timeline.at(-1)!.at;
  const firstTime = Date.parse(firstAt);
  const lastTime = Date.parse(lastAt);
  const markers = incident.markers.filter(({ at }) => {
    const markerTime = Date.parse(at);
    return markerTime >= firstTime && markerTime <= lastTime;
  });

  return (
    <section aria-labelledby="timeline-title" className="evidence-section">
      <div className="section-heading"><h3 id="timeline-title">Incident timeline</h3><p>Conversion, errors, and latency share one UTC time axis.</p></div>
      <figure className="timeline-figure">
        <div aria-label="Scrollable incident timeline" className="chart-scroll" tabIndex={0}>
          <svg aria-labelledby="timeline-svg-title timeline-svg-description" role="img" viewBox={`0 0 ${chartWidth} 232`}>
            <title id="timeline-svg-title">{`Checkout incident timeline for ${view.label}`}</title>
            <desc id="timeline-svg-description">Three aligned lanes show conversion rate, error rate, and p95 latency. Vertical lines mark deployment, incident start, and rollback.</desc>
            {lanes.map(({ metric, label, top, ceiling }) => (
              <g className={`timeline-lane lane-${metric}`} key={metric}>
                <text x="0" y={top + 12}>{label}</text>
                <line x1={chartLeft} x2={chartWidth - chartRight} y1={top + laneHeight} y2={top + laneHeight} />
                <polyline points={metricPoints(view.timeline, metric, top, ceiling)} />
              </g>
            ))}
            {markers.map((marker) => (
              <line className={`timeline-marker marker-${marker.kind}`} key={`${marker.kind}-${marker.at}`} x1={timelineX(marker.at, view.timeline)} x2={timelineX(marker.at, view.timeline)} y1="4" y2="214" />
            ))}
            <text className="timeline-time" x={chartLeft} y="229">{timeFormatter.format(new Date(firstAt))}</text>
            <text className="timeline-time timeline-time-end" x={chartWidth - chartRight} y="229">{timeFormatter.format(new Date(lastAt))} UTC</text>
          </svg>
        </div>
        <figcaption>The same marker positions apply across every lane; exact values are available below.</figcaption>
      </figure>
      <MarkerKey markers={markers} />
      <TimelineDetails view={view} />
    </section>
  );
}

function FunnelCell({ stage, kind }: Readonly<{
  stage: IncidentView["funnel"]["baseline"][number];
  kind: "baseline" | "incident";
}>) {
  return (
    <td>
      <span className="funnel-value"><strong>{countFormatter.format(stage.sessions)}</strong><span>{formatPercent(stage.completionFromStart)} complete · {formatPercent(stage.dropoffFromPrevious)} drop</span></span>
      <span aria-hidden="true" className="funnel-track"><span className={`funnel-fill funnel-${kind}`} style={{ width: `${stage.completionFromStart * 100}%` }} /></span>
    </td>
  );
}

function FunnelComparison({ view }: Readonly<{ view: IncidentView }>) {
  return (
    <section aria-labelledby="funnel-title" className="evidence-section">
      <div className="section-heading"><h3 id="funnel-title">Checkout funnel</h3><p>Baseline and incident counts at every stage.</p></div>
      <div aria-label="Scrollable funnel comparison" className="data-scroll" tabIndex={0}>
        <table className="funnel-table">
          <thead><tr><th scope="col">Stage</th><th scope="col">Baseline</th><th scope="col">Incident</th></tr></thead>
          <tbody>{view.funnel.baseline.map((baseline, index) => (
            <tr key={baseline.key}>
              <th scope="row">{baseline.label}</th>
              <FunnelCell kind="baseline" stage={baseline} />
              <FunnelCell kind="incident" stage={view.funnel.incident[index]!} />
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

const devices = ["desktop", "mobile", "tablet"] as const;

function isCause(incident: IncidentResult, entry: SegmentDelta) {
  const cause = incident.finding.affectedSegment;
  return entry.segment.version === cause.version &&
    entry.segment.region === cause.region &&
    entry.segment.device === cause.device;
}

function SegmentCell({ entry, incident, selectedViewId, onSelect }: Readonly<{
  entry: SegmentDelta;
  incident: IncidentResult;
  selectedViewId: string;
  onSelect: (viewId: string) => void;
}>) {
  const cause = isCause(incident, entry);
  const change = formatSignedPercent(entry.conversionRelativeChangePct);
  return (
    <td>
      <button aria-label={`${entry.segment.version}, ${entry.segment.region}, ${entry.segment.device}: ${change} conversion change, ${formatSignedPercent(entry.checkoutFailureRelativeChangePct)} checkout failure change${cause ? ", likely cause" : ""}.`} aria-pressed={selectedViewId === entry.viewId} data-cause={cause || undefined} data-tone={segmentTone(entry.conversionRelativeChangePct)} onClick={() => onSelect(entry.viewId)} type="button">
        <strong>{change}</strong><span>{cause ? "Likely cause" : `${formatPercent(entry.incidentConversionRate)} conversion`}</span>
      </button>
    </td>
  );
}

function SegmentHeatmap({ incident, selectedViewId, onSelect }: Readonly<{
  incident: IncidentResult;
  selectedViewId: string;
  onSelect: (viewId: string) => void;
}>) {
  const versions = [...new Set(incident.segments.map(({ segment }) => segment.version))];

  return (
    <section aria-labelledby="segments-title" className="evidence-section">
      <div className="section-heading"><h3 id="segments-title">Segment scan</h3><p>Conversion change by version, region, and device. Select a cell to update every view.</p></div>
      <div aria-label="Scrollable segment heatmap" className="data-scroll" tabIndex={0}>
        <table className="segment-table">
          <caption className="sr-only">Conversion change across all 24 scanned segments</caption>
          <thead><tr><th scope="col">Version</th><th scope="col">Region</th>{devices.map((device) => <th key={device} scope="col">{device}</th>)}</tr></thead>
          {versions.map((version) => {
            const regions = [...new Set(incident.segments.filter(({ segment }) => segment.version === version).map(({ segment }) => segment.region))];
            return (
              <tbody key={version}>{regions.map((region, regionIndex) => (
                <tr key={region}>
                  {regionIndex === 0 ? <th rowSpan={regions.length} scope="rowgroup">{version}</th> : null}
                  <th scope="row">{region}</th>
                  {/* ponytail: the contract fixes this at 24 cells; index it only if cardinality grows. */}
                  {devices.map((device) => {
                    const entry = incident.segments.find(({ segment }) => segment.version === version && segment.region === region && segment.device === device);
                    return entry ? <SegmentCell entry={entry} incident={incident} key={device} onSelect={onSelect} selectedViewId={selectedViewId} /> : <td key={device}>—</td>;
                  })}
                </tr>
              ))}</tbody>
            );
          })}
        </table>
      </div>
    </section>
  );
}

function IncidentEvidence({ incident, selectedViewId, onSelect, preview }: Readonly<{
  incident: IncidentResult;
  selectedViewId: string;
  onSelect: (viewId: string) => void;
  preview: boolean;
}>) {
  const view = selectIncidentView(incident, selectedViewId);

  return (
    <article aria-labelledby="finding-title" className="evidence-pane">
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
        <button aria-pressed={view.id === incident.defaultViewId} className="view-reset" onClick={() => onSelect(incident.defaultViewId)} type="button">All traffic</button>
      </div>
      <EvidenceMetrics view={view} />
      <TimelineChart incident={incident} view={view} />
      <FunnelComparison view={view} />
      <SegmentHeatmap incident={incident} onSelect={onSelect} selectedViewId={view.id} />
      <footer className="evidence-footer">
        <span>24 segments scanned</span>
        <span>Release {incident.finding.cause.version}</span>
        <span>Commit {incident.finding.cause.commitSha}</span>
      </footer>
    </article>
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
      {currentIncident ? (
        <IncidentEvidence
          incident={currentIncident}
          onSelect={setSelectedViewId}
          preview={!streamedIncident}
          selectedViewId={selectedViewId}
        />
      ) : (
        <EvidenceStatus busy={busy} failed={Boolean(error)} />
      )}
    </div>
  );
}
