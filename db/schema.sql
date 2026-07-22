CREATE DATABASE IF NOT EXISTS deploylens;

CREATE TABLE IF NOT EXISTS deploylens.events
(
    timestamp DateTime('UTC'),
    session_id UInt64,
    user_id UInt64,
    event_name LowCardinality(String),
    service LowCardinality(String),
    version LowCardinality(String),
    region LowCardinality(String),
    device LowCardinality(String),
    latency_ms UInt32,
    status_code UInt16
)
ENGINE = MergeTree
ORDER BY (service, timestamp, version, region, device, event_name, session_id);

CREATE TABLE IF NOT EXISTS deploylens.deployments
(
    timestamp DateTime('UTC'),
    service LowCardinality(String),
    version LowCardinality(String),
    commit_sha String,
    region LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (service, timestamp, version);

CREATE TABLE IF NOT EXISTS deploylens.minute_metrics
(
    service LowCardinality(String),
    minute DateTime('UTC'),
    version LowCardinality(String),
    region LowCardinality(String),
    device LowCardinality(String),
    sessions AggregateFunction(uniqExact, UInt64),
    checkout_starts AggregateFunction(sum, UInt64),
    errors AggregateFunction(sum, UInt64),
    purchases AggregateFunction(sum, UInt64),
    p95_latency_ms AggregateFunction(quantileExact(0.95), UInt32)
)
ENGINE = AggregatingMergeTree
ORDER BY (service, minute, version, region, device);

CREATE MATERIALIZED VIEW IF NOT EXISTS deploylens.minute_metrics_mv TO deploylens.minute_metrics AS
SELECT
    service,
    toStartOfMinute(timestamp) AS minute,
    version,
    region,
    device,
    uniqExactState(session_id) AS sessions,
    sumState(toUInt64(event_name = 'checkout_started')) AS checkout_starts,
    sumState(toUInt64(event_name = 'checkout_error')) AS errors,
    sumState(toUInt64(event_name = 'purchase')) AS purchases,
    quantileExactState(0.95)(latency_ms) AS p95_latency_ms
FROM deploylens.events
GROUP BY service, minute, version, region, device;
