import type { IncidentResult } from "./schema.ts";

export function selectIncidentView(incident: IncidentResult, selectedViewId: string) {
  return incident.views.find(({ id }) => id === selectedViewId)
    ?? incident.views.find(({ id }) => id === incident.defaultViewId)!;
}

export function normalizedTimelineX(at: string, timeline: readonly { at: string }[]) {
  const start = Date.parse(timeline[0]!.at);
  return (Date.parse(at) - start) / (Date.parse(timeline.at(-1)!.at) - start);
}

// ponytail: three bands fit the fixed 24-cell demo; add a continuous scale if cardinality grows.
export function segmentTone(relativeChangePct: number) {
  return relativeChangePct <= -10 ? "severe" : relativeChangePct <= -2 ? "down" : "stable";
}
