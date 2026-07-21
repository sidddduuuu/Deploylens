SELECT throwIf(
    count() != 200000
        OR uniqExact(session_id) != 50000
        OR uniqExact(tuple(version, region, device)) != 24
        OR countIf(version NOT IN ('1.8.2', '1.8.3')) != 0
        OR countIf(region NOT IN ('US-East', 'EU-West', 'EU-Central', 'AP-South')) != 0
        OR countIf(device NOT IN ('desktop', 'mobile', 'tablet')) != 0,
    'seed must contain 50,000 sessions, 200,000 events, and 24 segments'
)
FROM deploylens.events;

SELECT throwIf(
    count() != 2
        OR countIf(
            version = '1.8.3'
                AND timestamp = toDateTime('2026-07-20 14:18:00', 'UTC')
                AND commit_sha = 'a1843de'
                AND region = 'global'
        ) != 1
        OR countIf(
            version = '1.8.2'
                AND timestamp = toDateTime('2026-07-20 14:47:00', 'UTC')
                AND commit_sha = 'b7c21af'
                AND region = 'global'
        ) != 1,
    'deployment and rollback markers must match the incident'
)
FROM deploylens.deployments
WHERE service = 'checkout';

SELECT throwIf(count() != 0, 'every minute rollup bucket must match raw events')
FROM
(
    SELECT
        service,
        toStartOfMinute(timestamp) AS minute,
        version,
        region,
        device,
        toUInt8(1) AS raw_present,
        uniqExact(session_id) AS raw_sessions,
        countIf(event_name = 'checkout_started') AS raw_checkout_starts,
        countIf(event_name = 'checkout_error') AS raw_errors,
        countIf(event_name = 'purchase') AS raw_purchases,
        quantileExact(0.95)(latency_ms) AS raw_p95_latency_ms
    FROM deploylens.events
    GROUP BY service, minute, version, region, device
) AS raw
FULL OUTER JOIN
(
    SELECT
        service,
        minute,
        version,
        region,
        device,
        toUInt8(1) AS rollup_present,
        uniqExactMerge(sessions) AS rollup_sessions,
        sumMerge(checkout_starts) AS rollup_checkout_starts,
        sumMerge(errors) AS rollup_errors,
        sumMerge(purchases) AS rollup_purchases,
        quantileExactMerge(0.95)(p95_latency_ms) AS rollup_p95_latency_ms
    FROM deploylens.minute_metrics
    GROUP BY service, minute, version, region, device
) AS rollup USING (service, minute, version, region, device)
WHERE raw_present = 0
    OR rollup_present = 0
    OR raw_sessions != rollup_sessions
    OR raw_checkout_starts != rollup_checkout_starts
    OR raw_errors != rollup_errors
    OR raw_purchases != rollup_purchases
    OR raw_p95_latency_ms != rollup_p95_latency_ms;

SELECT throwIf(count() != 0, 'every session must contain the ordered checkout funnel')
FROM
(
    SELECT session_id
    FROM deploylens.events
    GROUP BY session_id
    HAVING windowFunnel(30)(
        timestamp,
        event_name = 'cart',
        event_name = 'checkout_started',
        event_name = 'payment_submitted',
        event_name IN ('purchase', 'checkout_error')
    ) != 4
);

WITH
    (
        SELECT tuple(countIf(event_name = 'checkout_error'), count())
        FROM deploylens.events
        WHERE service = 'checkout'
            AND version = '1.8.3'
            AND region = 'EU-West'
            AND device = 'mobile'
            AND timestamp >= toDateTime('2026-07-20 13:50:00', 'UTC')
            AND timestamp < toDateTime('2026-07-20 14:17:00', 'UTC')
            AND event_name IN ('purchase', 'checkout_error')
    ) AS baseline,
    (
        SELECT tuple(countIf(event_name = 'checkout_error'), count())
        FROM deploylens.events
        WHERE service = 'checkout'
            AND version = '1.8.3'
            AND region = 'EU-West'
            AND device = 'mobile'
            AND timestamp >= toDateTime('2026-07-20 14:20:00', 'UTC')
            AND timestamp < toDateTime('2026-07-20 14:47:00', 'UTC')
            AND event_name IN ('purchase', 'checkout_error')
    ) AS incident
SELECT throwIf(
    tupleElement(baseline, 1) = 0
        OR tupleElement(baseline, 2) = 0
        OR tupleElement(incident, 2) = 0
        OR abs(
            (tupleElement(incident, 1) / tupleElement(incident, 2))
                / (tupleElement(baseline, 1) / tupleElement(baseline, 2))
                - 1.37
        ) > 0.01,
    'target segment must show a 37 percent relative failure increase'
);

SELECT throwIf(
    count() != 23 OR max(abs(incident.failure_rate - baseline.failure_rate)) > 0.01,
    'all unaffected control segments must remain stable'
)
FROM
(
    SELECT
        version,
        region,
        device,
        countIf(event_name = 'checkout_error') / count() AS failure_rate
    FROM deploylens.events
    WHERE service = 'checkout'
        AND timestamp >= toDateTime('2026-07-20 13:50:00', 'UTC')
        AND timestamp < toDateTime('2026-07-20 14:17:00', 'UTC')
        AND event_name IN ('purchase', 'checkout_error')
    GROUP BY version, region, device
) AS baseline
INNER JOIN
(
    SELECT
        version,
        region,
        device,
        countIf(event_name = 'checkout_error') / count() AS failure_rate
    FROM deploylens.events
    WHERE service = 'checkout'
        AND timestamp >= toDateTime('2026-07-20 14:20:00', 'UTC')
        AND timestamp < toDateTime('2026-07-20 14:47:00', 'UTC')
        AND event_name IN ('purchase', 'checkout_error')
    GROUP BY version, region, device
) AS incident USING (version, region, device)
WHERE NOT (version = '1.8.3' AND region = 'EU-West' AND device = 'mobile');

WITH
    (
        SELECT tuple(countIf(event_name = 'checkout_error'), count())
        FROM deploylens.events
        WHERE service = 'checkout'
            AND version = '1.8.3'
            AND region = 'EU-West'
            AND device = 'mobile'
            AND timestamp >= toDateTime('2026-07-20 13:50:00', 'UTC')
            AND timestamp < toDateTime('2026-07-20 14:17:00', 'UTC')
            AND event_name IN ('purchase', 'checkout_error')
    ) AS baseline,
    (
        SELECT tuple(countIf(event_name = 'checkout_error'), count())
        FROM deploylens.events
        WHERE service = 'checkout'
            AND version = '1.8.3'
            AND region = 'EU-West'
            AND device = 'mobile'
            AND timestamp >= toDateTime('2026-07-20 14:47:00', 'UTC')
            AND timestamp < toDateTime('2026-07-20 15:14:00', 'UTC')
            AND event_name IN ('purchase', 'checkout_error')
    ) AS recovery
SELECT throwIf(
    tupleElement(baseline, 2) = 0
        OR tupleElement(recovery, 2) = 0
        OR abs(
            tupleElement(recovery, 1) / tupleElement(recovery, 2)
                - tupleElement(baseline, 1) / tupleElement(baseline, 2)
        ) > 0.01,
    'target segment must recover immediately after rollback'
);

SELECT 'ClickHouse smoke checks passed' AS result;
