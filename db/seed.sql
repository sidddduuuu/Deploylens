TRUNCATE TABLE events;
TRUNCATE TABLE deployments;
TRUNCATE TABLE minute_metrics;

INSERT INTO deployments VALUES
    ('2026-07-20 14:18:00', 'checkout', '1.8.3', 'a1843de', 'global'),
    ('2026-07-20 14:47:00', 'checkout', '1.8.2', 'b7c21af', 'global');

INSERT INTO events
SELECT
    session_started_at + tupleElement(stage, 2) AS timestamp,
    session_id,
    user_id,
    tupleElement(stage, 1) AS event_name,
    'checkout' AS service,
    version,
    region,
    device,
    toUInt32(if(affected, 420 + failure_bucket % 80, 180 + failure_bucket % 50)) AS latency_ms,
    toUInt16(if(event_name = 'checkout_error', 500, 200)) AS status_code
FROM
(
    SELECT
        *,
        version = '1.8.3'
            AND minute_index >= 50
            AND minute_index < 77
            AND region = 'EU-West'
            AND device = 'mobile' AS affected,
        if(
            affected,
            failure_bucket % 74 < 28,
            failure_bucket % 25 < 7
        ) AS failed
    FROM
    (
        SELECT
            number + 1 AS session_id,
            number % 40000 + 1 AS user_id,
            minute_index,
            toDateTime('2026-07-20 13:30:00', 'UTC')
                + minute_index * 60
                + round_index AS session_started_at,
            -- Canary and lingering cohorts make same-version windows comparable.
            if(round_index % 2 = 0, '1.8.2', '1.8.3') AS version,
            arrayElement(['US-East', 'EU-West', 'EU-Central', 'AP-South'], segment_index % 4 + 1) AS region,
            arrayElement(['desktop', 'mobile', 'tablet'], intDiv(segment_index, 4) + 1) AS device,
            minute_index * 35 + round_index AS failure_bucket
        FROM
        (
            SELECT
                number,
                number % 120 AS minute_index,
                intDiv(number, 120) % 12 AS segment_index,
                intDiv(number, 1440) AS round_index
            FROM numbers(50000)
        )
    )
)
ARRAY JOIN
[
    tuple('cart', toUInt8(0)),
    tuple('checkout_started', toUInt8(5)),
    tuple('payment_submitted', toUInt8(10)),
    tuple(if(failed, 'checkout_error', 'purchase'), toUInt8(15))
] AS stage;
