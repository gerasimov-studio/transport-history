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

ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language text
  CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'sr', 'ru'));
UPDATE users SET role = 'moderator' WHERE role = 'admin';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'moderator', 'superuser'));

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

ALTER TABLE events ADD COLUMN IF NOT EXISTS scope_id text;
UPDATE events SET scope_id = COALESCE(scope_id, city_id, 'world') WHERE scope_id IS NULL;
ALTER TABLE events ALTER COLUMN scope_id SET DEFAULT 'world';
ALTER TABLE events ALTER COLUMN scope_id SET NOT NULL;
ALTER TABLE events ALTER COLUMN city_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS events_scope_date_idx ON events (scope_id, occurred_on, id);

CREATE TABLE IF NOT EXISTS transport_systems (
  id text PRIMARY KEY, name text NOT NULL, aliases text[] NOT NULL DEFAULT '{}',
  lat double precision NOT NULL, lng double precision NOT NULL, zoom integer NOT NULL DEFAULT 11,
  valid_from date, valid_to date
);

CREATE TABLE IF NOT EXISTS transport_system_localities (
  system_id text NOT NULL REFERENCES transport_systems (id) ON DELETE CASCADE,
  locality_id text NOT NULL, name text NOT NULL,
  role text NOT NULL DEFAULT 'served' CHECK (role IN ('core', 'served', 'connected')),
  valid_from date, valid_to date, PRIMARY KEY (system_id, locality_id)
);

CREATE INDEX IF NOT EXISTS transport_system_localities_system_idx ON transport_system_localities (system_id);

-- Spatial read model. Events remain the source of truth; this projection makes
-- viewport reads independent from administrative boundaries.
CREATE TABLE IF NOT EXISTS network_infra (
  id text PRIMARY KEY,
  source_scope text NOT NULL,
  kind text NOT NULL,
  way text NOT NULL,
  valid_from date,
  valid_to date,
  payload jsonb NOT NULL,
  geom geometry(Geometry, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS network_infra_geom_gix ON network_infra USING GIST (geom);
CREATE INDEX IF NOT EXISTS network_infra_validity_idx ON network_infra (valid_from, valid_to);

CREATE TABLE IF NOT EXISTS network_routes (
  id text PRIMARY KEY,
  source_scope text NOT NULL,
  mode text NOT NULL,
  valid_from date,
  valid_to date,
  segment_ids text[] NOT NULL,
  geom geometry(LineString, 4326),
  payload jsonb NOT NULL
);

ALTER TABLE network_routes ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326);

CREATE INDEX IF NOT EXISTS network_routes_segments_gin ON network_routes USING GIN (segment_ids);
CREATE INDEX IF NOT EXISTS network_routes_geom_gix ON network_routes USING GIST (geom);
CREATE INDEX IF NOT EXISTS network_routes_validity_idx ON network_routes (valid_from, valid_to);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('canonical', 'scenario')),
  owner_id integer REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'link', 'public')),
  base_workspace_id text REFERENCES workspaces (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO workspaces (id, kind, title, visibility)
VALUES ('main', 'canonical', 'Основная мировая карта', 'public')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS changesets (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  author_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'changes_requested', 'rejected', 'published')),
  effective_on date NOT NULL,
  mode text NOT NULL,
  title text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  operations jsonb NOT NULL,
  bounds geometry(Geometry, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS changesets_workspace_status_idx ON changesets (workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS changesets_bounds_gix ON changesets USING GIST (bounds);
ALTER TABLE changesets ADD COLUMN IF NOT EXISTS scope_id text NOT NULL DEFAULT 'world';

CREATE TABLE IF NOT EXISTS moderation_areas (
  id text PRIMARY KEY,
  title text NOT NULL,
  modes text[] NOT NULL DEFAULT '{}',
  geom geometry(MultiPolygon, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moderation_areas_geom_gix ON moderation_areas USING GIST (geom);

CREATE TABLE IF NOT EXISTS moderation_assignments (
  area_id text NOT NULL REFERENCES moderation_areas (id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area_id, user_id)
);

CREATE TABLE IF NOT EXISTS changeset_reviews (
  id bigserial PRIMARY KEY,
  changeset_id text NOT NULL REFERENCES changesets (id) ON DELETE CASCADE,
  reviewer_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('published', 'changes_requested', 'rejected')),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
