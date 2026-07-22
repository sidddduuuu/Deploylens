"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import type { IncidentResult } from "./schema.ts";
import { normalizedTimelineX, segmentTone, selectIncidentView } from "./view.ts";

type IncidentView = IncidentResult["views"][number];
type SegmentDelta = IncidentResult["segments"][number];
type IncidentMarker = IncidentResult["markers"][number];
type TimelineMetric = "conversionRate" | "errorRate" | "p95LatencyMs";

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

function formatUtcTime(at: string) {
  return `${timeFormatter.format(new Date(at))} UTC`;
}

function formatUtcRange(from: string, to: string) {
  return `${timeFormatter.format(new Date(from))}–${formatUtcTime(to)}`;
}

const countFormatter = new Intl.NumberFormat("en");

function checkoutConversion(stages: IncidentView["funnel"]["baseline"]) {
  const starts = stages.find(({ key }) => key === "checkout_started")!.sessions;
  const purchases = stages.find(({ key }) => key === "purchase")!.sessions;
  return starts === 0 ? 0 : purchases / starts;
}

function EvidenceMetrics({ view }: Readonly<{ view: IncidentView }>) {
  const reduceMotion = useReducedMotion();
  const baselineConversion = checkoutConversion(view.funnel.baseline);
  const incidentConversion = checkoutConversion(view.funnel.incident);
  const peakLatency = Math.max(...view.timeline.map(({ p95LatencyMs }) => p95LatencyMs));
  const relativeChange = baselineConversion === 0
    ? 0
    : incidentConversion / baselineConversion - 1;

  return (
    <motion.dl
      animate={{ opacity: 1, y: 0 }}
      className="metrics"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      key={view.id}
      transition={{ duration: 0.35 }}
    >
      <div><dt>Baseline conversion</dt><dd>{formatPercent(baselineConversion)}</dd></div>
      <div><dt>Incident conversion</dt><dd>{formatPercent(incidentConversion)}</dd></div>
      <div><dt>Relative change</dt><dd className={relativeChange < 0 ? "negative" : undefined}>{formatPercent(relativeChange)}</dd></div>
      <div><dt>Peak p95 latency</dt><dd>{peakLatency.toFixed(0)} ms</dd></div>
    </motion.dl>
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
          <caption className="sr-only">{`Timeline values for ${view.label}`}</caption>
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
  const reduceMotion = useReducedMotion();
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
      <div className="section-heading"><h3 id="timeline-title">Incident timeline</h3><p>Shows whether the regression follows the deploy and recovers after rollback.</p></div>
      <figure className="timeline-figure">
        <div aria-label="Scrollable incident timeline" className="chart-scroll" tabIndex={0}>
          <svg aria-labelledby="timeline-svg-title timeline-svg-description" role="img" viewBox={`0 0 ${chartWidth} 232`}>
            <title id="timeline-svg-title">{`Checkout incident timeline for ${view.label}`}</title>
            <desc id="timeline-svg-description">Three aligned lanes show conversion rate, error rate, and p95 latency. Vertical lines mark deployment, incident start, and rollback.</desc>
            {lanes.map(({ metric, label, top, ceiling }, index) => {
              const points = metricPoints(view.timeline, metric, top, ceiling);
              return (
                <g className={`timeline-lane lane-${metric}`} key={`${view.id}-${metric}`}>
                  <text x="0" y={top + 12}>{label}</text>
                  <line x1={chartLeft} x2={chartWidth - chartRight} y1={top + laneHeight} y2={top + laneHeight} />
                  <motion.polyline
                    animate={{ opacity: 1, pathLength: 1 }}
                    initial={reduceMotion ? false : { opacity: 0.2, pathLength: 0 }}
                    points={points}
                    transition={{ delay: index * 0.08, duration: 0.7, ease: "easeOut" }}
                  />
                </g>
              );
            })}
            {markers.map((marker, index) => (
              <motion.line
                animate={{ opacity: 1 }}
                className={`timeline-marker marker-${marker.kind}`}
                initial={reduceMotion ? false : { opacity: 0 }}
                key={`${marker.kind}-${marker.at}`}
                transition={{ delay: 0.35 + index * 0.08, duration: 0.35 }}
                x1={timelineX(marker.at, view.timeline)}
                x2={timelineX(marker.at, view.timeline)}
                y1="4"
                y2="214"
              />
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
  const reduceMotion = useReducedMotion();
  return (
    <td>
      <span className="funnel-value"><strong>{countFormatter.format(stage.sessions)}</strong><span>{formatPercent(stage.completionFromStart)} complete · {formatPercent(stage.dropoffFromPrevious)} drop</span></span>
      <span aria-hidden="true" className="funnel-track">
        <motion.span
          animate={{ width: `${stage.completionFromStart * 100}%` }}
          className={`funnel-fill funnel-${kind}`}
          initial={reduceMotion ? false : { width: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        />
      </span>
    </td>
  );
}

function FunnelComparison({ view }: Readonly<{ view: IncidentView }>) {
  return (
    <section aria-labelledby="funnel-title" className="evidence-section">
      <div className="section-heading"><h3 id="funnel-title">Checkout funnel</h3><p>Isolates which checkout stage lost users during the incident.</p></div>
      <div aria-label="Scrollable funnel comparison" className="data-scroll" tabIndex={0}>
        <table className="funnel-table">
          <caption className="sr-only">{`Baseline and incident funnel for ${view.label}`}</caption>
          <thead><tr><th scope="col">Stage</th><th scope="col">Baseline</th><th scope="col">Incident</th></tr></thead>
          <tbody>{view.funnel.baseline.map((baseline, index) => (
            <tr key={`${view.id}-${baseline.key}`}>
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
      <motion.button
        aria-label={`${entry.segment.version}, ${entry.segment.region}, ${entry.segment.device}: ${change} conversion change, ${formatSignedPercent(entry.checkoutFailureRelativeChangePct)} checkout failure change${cause ? ", likely cause" : ""}.`}
        aria-pressed={selectedViewId === entry.viewId}
        data-cause={cause || undefined}
        data-tone={segmentTone(entry.conversionRelativeChangePct)}
        onClick={() => onSelect(entry.viewId)}
        type="button"
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.98 }}
      >
        <strong>{change}</strong><span>{cause ? "Likely cause" : `${formatPercent(entry.incidentConversionRate)} conversion`}</span>
      </motion.button>
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
      <div className="section-heading"><h3 id="segments-title">Segment scan</h3><p>Finds the affected version, region, and device; selecting one updates every view.</p></div>
      <p className="scroll-cue">Scroll horizontally to compare devices.</p>
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
  const reduceMotion = useReducedMotion();
  const view = selectIncidentView(incident, selectedViewId);
  const defaultView = selectIncidentView(incident, incident.defaultViewId);
  const resetLabel = defaultView.label === "All checkout traffic"
    ? "All traffic"
    : defaultView.label === "All mobile checkout traffic"
      ? "All mobile traffic"
      : defaultView.label;

  return (
    <motion.article
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="finding-title"
      className="evidence-pane"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {preview ? (
        <p className="preview-notice" role="note">Example result — no live investigation has run yet.</p>
      ) : null}
      <header className="evidence-header">
        <div>
          <p className="eyebrow">
            {preview ? "Fixture preview" : "Live incident"} · {incident.incidentId}
          </p>
          <h2 id="finding-title">{incident.finding.headline}</h2>
        </div>
        <span className="confidence">{incident.finding.confidence} confidence</span>
      </header>
      <dl className="finding-facts">
        <div>
          <dt>Affected</dt>
          <dd>{[
            incident.finding.affectedSegment.version,
            incident.finding.affectedSegment.region,
            incident.finding.affectedSegment.device,
          ].join(" / ")}</dd>
        </div>
        <div>
          <dt>Deployment</dt>
          <dd>{`Release ${incident.finding.cause.version} · ${incident.finding.cause.commitSha} · ${formatUtcTime(incident.finding.cause.deployedAt)}`}</dd>
        </div>
        <div>
          <dt>Incident window</dt>
          <dd>{formatUtcRange(incident.windows.incident.from, incident.windows.incident.to)}</dd>
        </div>
        <div><dt>Evidence</dt><dd>Timeline, funnel, deployment marker, and segment scan</dd></div>
      </dl>
      <div className="evidence-toolbar">
        <div><span>Active scope</span><strong>{view.label}</strong></div>
        <button aria-pressed={view.id === incident.defaultViewId} className="view-reset" onClick={() => onSelect(incident.defaultViewId)} type="button">{resetLabel}</button>
      </div>
      <p aria-atomic="true" aria-label="Evidence scope update" className="sr-only" role="status">
        {view.id === incident.defaultViewId
          ? `Showing ${defaultView.label.toLowerCase()}.`
          : `Filtered to ${view.label}; metrics, timeline, and funnel updated.`}
      </p>
      <EvidenceMetrics view={view} />
      <TimelineChart incident={incident} view={view} />
      <FunnelComparison view={view} />
      <SegmentHeatmap incident={incident} onSelect={onSelect} selectedViewId={view.id} />
      <footer className="evidence-footer">
        <span>24 segments scanned</span>
        <span>Schema-validated evidence</span>
        <span>UTC</span>
      </footer>
    </motion.article>
  );
}

export function ActiveIncidentEvidence({ incident, preview }: Readonly<{
  incident: IncidentResult;
  preview: boolean;
}>) {
  const [selectedViewId, setSelectedViewId] = useState(incident.defaultViewId);
  return (
    <IncidentEvidence
      incident={incident}
      onSelect={setSelectedViewId}
      preview={preview}
      selectedViewId={selectedViewId}
    />
  );
}

export function IncidentPreview({ incident }: Readonly<{ incident: IncidentResult }>) {
  return <ActiveIncidentEvidence incident={incident} preview />;
}
