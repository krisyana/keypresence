-- KeyPresence schema v1. See docs/adr/0003-data-model.md

CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  start_time time NOT NULL,
  end_time time NOT NULL,                       -- may be earlier than start_time for overnight shifts (not supported in v1, validated)
  grace_minutes int NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 120),
  overtime_after_minutes int NOT NULL DEFAULT 15 CHECK (overtime_after_minutes BETWEEN 0 AND 240),
  auto_close_after_minutes int NOT NULL DEFAULT 120 CHECK (auto_close_after_minutes BETWEEN 15 AND 720),
  work_days int[] NOT NULL DEFAULT '{1,2,3,4,5}', -- ISO: 1=Mon .. 7=Sun
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','employee')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  location_consent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m int NOT NULL CHECK (radius_m BETWEEN 5 AND 5000),
  max_accuracy_m int NOT NULL DEFAULT 50 CHECK (max_accuracy_m BETWEEN 5 AND 1000),
  enforcement text NOT NULL DEFAULT 'reject' CHECK (enforcement IN ('reject','flag','off')),
  qr_secret text NOT NULL,
  qr_epoch int NOT NULL DEFAULT 1,
  qr_rotated_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id),
  kind text NOT NULL CHECK (kind IN ('attendance','visitor','event','asset','task')),
  subject_ref text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  day date NOT NULL,                              -- local business day of check-in (org timezone)
  check_in_at timestamptz NOT NULL,
  check_out_at timestamptz,
  in_lat double precision, in_lng double precision, in_accuracy_m double precision, in_distance_m double precision,
  out_lat double precision, out_lng double precision, out_accuracy_m double precision, out_distance_m double precision,
  in_flags text[] NOT NULL DEFAULT '{}',
  out_flags text[] NOT NULL DEFAULT '{}',
  review_status text NOT NULL DEFAULT 'none' CHECK (review_status IN ('none','pending','reviewed')),
  review_note text, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  closed_by text CHECK (closed_by IN ('user','auto','admin')),
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  late_minutes int NOT NULL DEFAULT 0,
  overtime_minutes int NOT NULL DEFAULT 0,
  work_minutes int,
  override_by uuid REFERENCES users(id),
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR check_out_at IS NOT NULL),
  CHECK (check_out_at IS NULL OR check_out_at >= check_in_at)
);
-- One open record per (user, kind, subject). Makes concurrent double check-in impossible.
CREATE UNIQUE INDEX checkins_one_open ON checkins (user_id, kind, coalesce(subject_ref, '')) WHERE status = 'open';
CREATE INDEX checkins_day ON checkins (day);
CREATE INDEX checkins_user_day ON checkins (user_id, day);
CREATE INDEX checkins_site_day ON checkins (site_id, day);
CREATE INDEX checkins_review ON checkins (review_status) WHERE review_status = 'pending';

-- Every attempt, accepted or not. No raw coordinates here: privacy (ADR-0006).
CREATE TABLE attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('in','out')),
  kind text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted','flagged','rejected')),
  reasons text[] NOT NULL DEFAULT '{}',
  distance_m double precision,
  accuracy_m double precision,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempts_user_at ON attempts(user_id, at DESC);

CREATE TABLE corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id uuid NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_check_in_at timestamptz,
  proposed_check_out_at timestamptz,
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (proposed_check_in_at IS NOT NULL OR proposed_check_out_at IS NOT NULL)
);
CREATE INDEX corrections_status ON corrections(status);
CREATE UNIQUE INDEX corrections_one_pending ON corrections(checkin_id) WHERE status = 'pending';

CREATE TABLE absences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE daily_summaries (
  day date PRIMARY KEY,
  data jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,                                   -- null for system
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_at ON audit_log(at DESC);

CREATE TABLE ai_queries (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL,
  question text NOT NULL,
  plan jsonb,
  outcome text NOT NULL CHECK (outcome IN ('answered','refused','invalid_plan')),
  redactions int NOT NULL DEFAULT 0
);

CREATE TABLE job_runs (
  job text NOT NULL,
  key text NOT NULL,                               -- e.g. the day the run is for; makes jobs idempotent
  ran_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (job, key)
);
