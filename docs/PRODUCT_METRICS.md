# Product metrics contract

These metrics measure whether Mygotham creates a repeated learning habit. They
do not treat page views, imported games, generated analyses, or total accounts
as success on their own. All analytics queries cover only users who permit
first-party telemetry; report coverage beside every rate.

## Canonical definitions

- **First value:** a user with `first_10_ready` who subsequently emits
  `first_reading_viewed` or `first_reading_opened`. Report both stages and
  median time-to-first-value; this is not activation by itself.
- **Activated learner:** a user with `first_10_ready` who completes at least one
  `session_completed` within 7 days. This is the canonical activation rate.
- **Core action:** one `session_completed`. A session start, page view, or LLM
  response is not a completed learning action.
- **Analysis coverage:** `full_100_or_available_ready` is emitted only when all
  selected games produced valid analyses. `background_analysis_partial` carries
  `games_analyzed`, `games_selected`, and `games_failed`; the stable
  `analysis_completion_id` makes reload submissions idempotent. Never report a
  partial 97/100 corpus as 100/100.
- **D7 retention:** among users whose first `session_completed` is day 0, the
  share with another `session_completed` on calendar day 7 (UTC). Also show a
  sensitivity window of days 6-8; never silently substitute it for strict D7.
- **W4 retention:** among the same cohort, the share with a
  `session_completed` during UTC days 22-28 after day 0.
- **Recurring learner (operating metric):** at least two distinct UTC days with
  `session_completed` in the last 28 days, including at least one distinct day
  in the last 7 days. The acquisition target is 10-15K users satisfying this
  definition, not 10-15K registrations or monthly visitors.
- **Transfer opportunity:** one unique row in
  `anchor_transfer_observations`, recorded for a real later-game position after
  at least one evaluated guided/drill/review attempt on that anchor. The RPC
  makes `(user_id, anchor_key, observation_key)` idempotent and rejects anchors
  without prior evaluated training.
- **Transfer success:** an opportunity whose `success` is true. Show a rate for
  a user/anchor only with at least 5 opportunities; below that print
  "insufficient evidence," never 0%. Product-wide transfer should carry its
  denominator and a 95% interval. Do not promote a product-wide rate before at
  least 20 opportunities from at least 10 users and 20 distinct source games.

## Reference SQL

First value and activated learner:

```sql
with ready as (
  select user_id, min(created_at) as ready_at
  from analytics_events where event_name = 'first_10_ready'
  group by user_id
), milestones as (
  select r.user_id, r.ready_at,
         min(e.created_at) filter (
           where e.event_name in ('first_reading_viewed', 'first_reading_opened')
         ) as first_value_at,
         min(e.created_at) filter (
           where e.event_name = 'session_completed'
         ) as activated_at
  from ready r left join analytics_events e
    on e.user_id = r.user_id
   and e.event_name in ('first_reading_viewed', 'first_reading_opened', 'session_completed')
   and e.created_at between r.ready_at and r.ready_at + interval '7 days'
  group by r.user_id, r.ready_at
)
select count(*) as eligible_users,
       count(first_value_at) as first_value_users,
       count(activated_at) as activated_learners,
       round(count(activated_at)::numeric / nullif(count(*), 0), 4) as activation_rate,
       percentile_cont(0.5) within group
         (order by extract(epoch from first_value_at - ready_at) / 60)
         filter (where first_value_at is not null) as median_minutes_to_first_value
from milestones;
```

D7 and W4 retention from the first core action:

```sql
with first_session as (
  select user_id, min(created_at at time zone 'UTC')::date as day_0
  from analytics_events where event_name = 'session_completed'
  group by user_id
), activity as (
  select distinct user_id, (created_at at time zone 'UTC')::date as active_day
  from analytics_events where event_name = 'session_completed'
)
select count(*) as cohort,
       count(*) filter (where exists (
         select 1 from activity a
         where a.user_id = f.user_id and a.active_day = f.day_0 + 7
       )) as retained_d7,
       count(*) filter (where exists (
         select 1 from activity a
         where a.user_id = f.user_id
           and a.active_day between f.day_0 + 22 and f.day_0 + 28
       )) as retained_w4
from first_session f
where day_0 <= (now() at time zone 'UTC')::date - 28;
```

Current recurring learners:

```sql
with days as (
  select user_id, (created_at at time zone 'UTC')::date as active_day
  from analytics_events
  where event_name = 'session_completed'
    and (created_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 27
  group by user_id, (created_at at time zone 'UTC')::date
)
select count(*) as recurring_learners
from (
  select user_id
  from days
  group by user_id
  having count(*) >= 2
     and count(*) filter (
       where active_day >= (now() at time zone 'UTC')::date - 6
     ) >= 1
) recurring;
```

Track WAU/MAU beside the deliberately low recurring threshold:

```sql
select count(distinct user_id) filter (
         where (created_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 6
       ) as wau,
       count(distinct user_id) filter (
         where (created_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 27
       ) as mau,
       round(
         count(distinct user_id) filter (
           where (created_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 6
         )::numeric /
         nullif(count(distinct user_id) filter (
           where (created_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 27
         ), 0), 4
       ) as wau_mau
from analytics_events
where event_name = 'session_completed';
```

Also report how many users were active in at least two distinct UTC weeks in
the same 28-day window:

```sql
with per_user as (
  select user_id,
         count(distinct date_trunc('week', created_at at time zone 'UTC')) as active_weeks
  from analytics_events
  where event_name = 'session_completed'
    and (created_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date - 27
  group by user_id
)
select count(*) filter (where active_weeks >= 2) as users_active_two_weeks,
       round(avg(active_weeks), 2) as average_active_weeks
from per_user;
```

Transfer, withholding sparse rates:

```sql
select user_id, anchor_key,
       count(*) as opportunities,
       count(*) filter (where success) as successes,
       case when count(*) >= 5 then
         round(count(*) filter (where success)::numeric / count(*), 4)
       else null end as transfer_rate
from anchor_transfer_observations
group by user_id, anchor_key;
```

Product-wide readiness guard:

```sql
select count(*) as opportunities,
       count(distinct user_id) as users,
       count(distinct source_game_id) as source_games,
       case when count(*) >= 20
              and count(distinct user_id) >= 10
              and count(distinct source_game_id) >= 20
            then round(count(*) filter (where success)::numeric / count(*), 4)
            else null end as publishable_transfer_rate
from anchor_transfer_observations;
```

Analysis completion coverage:

```sql
select event_name,
       sum((properties->>'games_analyzed')::int) as analyses_succeeded,
       sum((properties->>'games_selected')::int) as games_selected,
       sum((properties->>'games_failed')::int) as analyses_failed
from analytics_events
where event_name = 'background_analysis_partial'
group by event_name;
```

## Reporting guardrails

Always publish counts beside rates, UTC date boundaries, the query version, and
telemetry coverage. Segment by acquisition cohort and time control before
claiming improvement. Do not call a change causal without an experiment or a
credible comparison group, and do not infer learning from Stockfish loss,
Maia raw policy mass, LLM output count, or time spent alone.
