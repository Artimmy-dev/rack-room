# Tempo Champs

A weight-room scoreboard for coaches: manage athletes and their maxes, build
timed workouts, auto-group athletes onto racks, and run the session full-screen
on a TV with big timers, per-rack working weights, and countdown beeps.

**Calendar** — schedule workouts on a month grid and start one straight from the
day it was planned for. Finished runs, testing days and logged sessions show up
on the day they happened.

**Data** — four views over the season:
* *Test entry* — a testing-day sheet for the whole squad, any date, rep maxes included.
* *Workout entry* — log a session that happened, with who was there. Runs you
  finish on the TV log themselves.
* *Reports* — sessions, attendance and pounds added, per athlete, over a date range.
* *Leaderboard* — heaviest, most improved, and most sessions attended.

**Launch:** double-click `TempoChamps.bat` (opens as a desktop app window in Edge).

All data stays on this PC (browser localStorage). Nothing is sent anywhere
unless you turn on cloud accounts — see below.

## Cloud accounts (optional)

Off by default: with `sync.js` unconfigured the app behaves exactly as it
always has — everything local, nothing sent anywhere.

To let coaches sign in and have their athletes and workouts follow them to any
device:

1. Create a project at supabase.com.
2. In the SQL editor, run:

```sql
create table coach_state (
  user_id    uuid primary key references auth.users on delete cascade,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
alter table coach_state enable row level security;
create policy "own row only" on coach_state for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

3. Copy the Project URL and the **Publishable** key (older dashboards call it
   `anon` / `public`) from Project Settings -> API into the two variables at
   the top of `sync.js`. Never the `Secret` / `service_role` key.

The publishable key is meant to ship in client code — that row-level security policy
is what keeps one coach out of another's roster, so do not skip step 2.

**How it behaves:** localStorage stays the source of truth, so the app boots
and runs a whole session with no network; edits push about two seconds after
you stop typing. A device that has signed in once never sees the login screen
again, online or not. Sync is whole-document last-write-wins — if the same
account is edited on two devices at once, the app asks rather than picking a
loser, and the copy it sets aside is recoverable from the `rackroom.preSync`
localStorage key.
