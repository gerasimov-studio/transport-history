CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS cities (
  id text PRIMARY KEY,
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  zoom integer NOT NULL,
  min_zoom integer NOT NULL,
  max_zoom integer NOT NULL
);

CREATE TABLE IF NOT EXISTS mode_codes (
  code text PRIMARY KEY,
  mode text NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities (id) ON DELETE CASCADE,
  mode text NOT NULL,
  on_date date NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  UNIQUE (city_id, mode, on_date)
);

CREATE TABLE IF NOT EXISTS lines (
  id text PRIMARY KEY,
  city_id text NOT NULL REFERENCES cities (id) ON DELETE CASCADE,
  mode text NOT NULL,
  number text NOT NULL,
  name text NOT NULL,
  color text NOT NULL,
  UNIQUE (city_id, mode, number)
);

CREATE TABLE IF NOT EXISTS features (
  id bigserial PRIMARY KEY,
  snapshot_id text NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('track', 'stop', 'node')),
  line_id text NOT NULL,
  name text NOT NULL,
  color text NOT NULL,
  track_form text NOT NULL DEFAULT 'double',
  node_kind text,
  geom geometry(Geometry, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS features_snapshot_idx ON features (snapshot_id);
CREATE INDEX IF NOT EXISTS features_line_idx ON features (line_id);
CREATE INDEX IF NOT EXISTS features_geom_gix ON features USING GIST (geom);

ALTER TABLE features DROP CONSTRAINT IF EXISTS features_kind_check;
ALTER TABLE features ADD CONSTRAINT features_kind_check CHECK (kind IN ('track', 'stop', 'node'));
ALTER TABLE features ADD COLUMN IF NOT EXISTS track_form text NOT NULL DEFAULT 'double';
ALTER TABLE features ADD COLUMN IF NOT EXISTS node_kind text;
ALTER TABLE features DROP CONSTRAINT IF EXISTS features_track_form_check;
ALTER TABLE features ADD CONSTRAINT features_track_form_check
  CHECK (track_form IN ('double', 'single_oneway', 'single_both'));
ALTER TABLE features DROP CONSTRAINT IF EXISTS features_node_kind_check;
ALTER TABLE features ADD CONSTRAINT features_node_kind_check
  CHECK (node_kind IS NULL OR node_kind IN ('junction', 'terminus', 'loop', 'wye', 'crossover', 'portal'));

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  occurred_on date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  city_id text NOT NULL REFERENCES cities (id) ON DELETE CASCADE,
  actor text,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS events_city_date_idx ON events (city_id, occurred_on, id);
