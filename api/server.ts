import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSession,
  destroySession,
  hashPassword,
  userFromRequest,
  verifyPassword,
} from './auth.ts'
import { clearCookie, cookieValue, readJson, send, setCookie } from './http.ts'
import { buildMapSvg } from './exportSvg.ts'
import {
  asDate,
  asGrade,
  asGauge,
  asLevel,
  asNodeKind,
  asTrackForm,
  asWay,
  diffAndBuildEvents,
  projectEvents,
  renderFeatures,
  wayOf,
  type InfraEntity,
  type RouteEntity,
  type StoredEvent,
  type TransportMode,
  type TransportWay,
} from './project.ts'
import { migrateAndSeed } from './seed.ts'

const port = Number(process.env.PORT ?? 3001)
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://th:th@127.0.0.1:5433/th'
const seedDir = join(dirname(fileURLToPath(import.meta.url)), '../db/seed')
const modes = new Set(['metro', 'tram', 'trolleybus', 'bus'])
const ways = new Set(['rail', 'road'])
const trackForms = new Set(['double', 'single_oneway', 'single_both'])
const nodeKinds = new Set(['junction', 'terminus', 'loop', 'wye', 'crossover', 'portal'])
const nodeLineKinds = new Set(['loop', 'wye', 'crossover'])

const pool = new pg.Pool({ connectionString: databaseUrl })

type SnapshotInput = {
  city?: string
  mode?: string
  date?: string
  title?: string
  summary?: string
  features?: Array<{
    properties?: {
      kind?: string
      lineId?: string
      number?: string
      name?: string
      color?: string
      trackForm?: string
      nodeKind?: string
    }
    geometry?: { type?: string; coordinates?: unknown }
  }>
}

type CommitInput = {
  city?: string
  date?: string
  mode?: string
  way?: string
  title?: string
  summary?: string
  infra?: unknown
  routes?: unknown
}

type ObjectCommitInput = {
  workspaceId?: string
  changeSetId?: string
  date?: string
  mode?: string
  title?: string
  summary?: string
  upsertInfra?: unknown
  removeInfra?: unknown
  upsertRoutes?: unknown
  removeRoutes?: unknown
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

async function waitForDatabase() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      await pool.query('SELECT 1')
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw new Error('database is not ready')
}

function lineKey(city: string, mode: string, number: string) {
  return `${city}-${mode}-${number.trim() || '1'}`
}

function numberFromLineId(lineId: string, city: string, mode: string) {
  const prefix = `${city}-${mode}-`
  if (lineId.startsWith(prefix)) {
    return lineId.slice(prefix.length)
  }
  return lineId.replace(/^(tm-|line-)/, '') || '1'
}

function snapshotKey(city: string, mode: string, date: string) {
  return `${city}-${mode}-${date}`
}

function catalogCity(row: { lat: number; lng: number; id: string; name: string; aliases: string[]; zoom: number; minZoom: number; maxZoom: number }) {
  const { lat, lng, ...rest } = row
  return { ...rest, center: [lat, lng] }
}

async function loadEvents(city: string): Promise<StoredEvent[]> {
  const result = await pool.query<StoredEvent>(
    `SELECT id, type, occurred_on::text AS "occurredOn", city_id AS "cityId", actor, payload
     FROM events
     WHERE scope_id = $1
     ORDER BY occurred_on, id`,
    [city],
  )
  return result.rows
}

async function syncSpatialProjection(sourceScope: string) {
  const state = projectEvents(await loadEvents(sourceScope))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM network_routes WHERE source_scope = $1', [sourceScope])
    await client.query('DELETE FROM network_infra WHERE source_scope = $1', [sourceScope])
    for (const entity of state.infra.values()) {
      await client.query(
        `INSERT INTO network_infra
           (id, source_scope, kind, way, valid_from, valid_to, payload, geom)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb,
           ST_SetSRID(ST_GeomFromGeoJSON($8), 4326))`,
        [
          entity.id,
          sourceScope,
          entity.kind,
          entity.way,
          entity.since ?? null,
          entity.until ?? null,
          JSON.stringify(entity),
          JSON.stringify(entity.geometry),
        ],
      )
    }
    for (const route of state.routes.values()) {
      await client.query(
        `INSERT INTO network_routes
           (id, source_scope, mode, valid_from, valid_to, segment_ids, geom, payload)
         VALUES ($1, $2, $3, $4, $5, $6,
           CASE WHEN $7::jsonb IS NULL OR jsonb_array_length($7::jsonb->'coordinates') < 2
             THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($7), 4326) END,
           $8::jsonb)`,
        [
          route.id,
          sourceScope,
          route.mode,
          route.since ?? null,
          route.until ?? null,
          route.segmentIds,
          route.geometry ? JSON.stringify(route.geometry) : null,
          JSON.stringify(route),
        ],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function syncAllSpatialProjections() {
  const scopes = await pool.query<{ id: string }>('SELECT DISTINCT scope_id AS id FROM events ORDER BY scope_id')
  for (const scope of scopes.rows) {
    await syncSpatialProjection(scope.id)
  }
}

async function catalogFromEvents() {
  const cities = await pool.query(
    `SELECT id, name, aliases, lat, lng, zoom, min_zoom AS "minZoom", max_zoom AS "maxZoom"
     FROM cities ORDER BY id`,
  )
  const codes = await pool.query('SELECT code, mode FROM mode_codes')
  const dateSet = new Set<string>()
  const eventDates = await pool.query<{ date: string }>(
    'SELECT DISTINCT occurred_on::text AS date FROM events ORDER BY date',
  )
  for (const row of eventDates.rows) dateSet.add(row.date)
  const lines = []
  const snapshots = []
  for (const city of cities.rows) {
    const events = await loadEvents(city.id)
    const state = projectEvents(events)
    for (const event of events) {
      dateSet.add(event.occurredOn)
    }
    for (const entity of state.infra.values()) {
      if (entity.since) {
        dateSet.add(entity.since)
      }
      if (entity.until) {
        dateSet.add(entity.until)
      }
    }
    for (const route of state.routes.values()) {
      if (route.since) {
        dateSet.add(route.since)
      }
      if (route.until) {
        dateSet.add(route.until)
      }
      lines.push({
        id: route.id,
        city: city.id,
        mode: route.mode,
        number: route.number,
        name: route.name,
        color: route.color,
      })
    }
    for (const chronicle of state.chronicles.values()) {
      dateSet.add(chronicle.date)
      snapshots.push({
        ...chronicle,
        city: city.id,
        network: '',
      })
    }
  }
  snapshots.sort(
    (left, right) => left.date.localeCompare(right.date) || left.mode.localeCompare(right.mode),
  )
  lines.sort(
    (left, right) =>
      left.mode.localeCompare(right.mode) ||
      left.number.localeCompare(right.number, 'ru', { numeric: true }),
  )
  return {
    cities: cities.rows.map((row) => catalogCity(row)),
    lines,
    modeCodes: Object.fromEntries(codes.rows.map((row) => [row.code, row.mode])),
    dates: [...dateSet].sort(),
    snapshots,
  }
}

async function catalogPayload() {
  return catalogFromEvents()
}

async function statePayload(city: string, date: string) {
  const cityRow = await pool.query('SELECT id FROM cities WHERE id = $1', [city])
  if (!cityRow.rowCount) {
    throw new Error('city')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date')
  }
  const state = projectEvents(await loadEvents(city), date)
  return {
    city,
    date,
    infra: [...state.infra.values()],
    routes: [...state.routes.values()],
    chronicles: [...state.chronicles.values()].sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
    features: renderFeatures(state, undefined, date),
  }
}

type Bounds = {
  west: number
  south: number
  east: number
  north: number
}

function asBounds(raw: string): Bounds | null {
  const values = raw.split(',').map(Number)
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null
  }
  const [rawWest, rawSouth, rawEast, rawNorth] = values as [number, number, number, number]
  const west = Math.max(-180, rawWest)
  const east = Math.min(180, rawEast)
  const south = Math.max(-90, rawSouth)
  const north = Math.min(90, rawNorth)
  if (west >= east || south >= north) {
    return null
  }
  return { west, south, east, north }
}

function entityInBounds(entity: { geometry?: { coordinates: unknown } }, bounds: Bounds) {
  const coordinates: [number, number][] = []
  const collect = (value: unknown) => {
    if (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number')) {
      coordinates.push(value as [number, number])
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item)
    }
  }
  collect(entity.geometry?.coordinates)
  if (!coordinates.length) return false
  const lngs = coordinates.map((point) => point[0])
  const lats = coordinates.map((point) => point[1])
  return Math.min(...lngs) <= bounds.east && Math.max(...lngs) >= bounds.west &&
    Math.min(...lats) <= bounds.north && Math.max(...lats) >= bounds.south
}

async function mapPayload(bounds: Bounds, date: string, zoom: number, fullDetail = false, workspaceId = 'main') {
  const kindClause = fullDetail ? '' : zoom < 14 ? "AND kind = 'track'" : zoom < 15 ? "AND kind <> 'node'" : ''
  const result = await pool.query<{ payload: InfraEntity; source_scope: string }>(
    `SELECT payload, source_scope
     FROM network_infra
     WHERE (valid_from IS NULL OR valid_from <= $1)
       AND (valid_to IS NULL OR valid_to >= $1)
       AND ST_Intersects(
         geom,
         ST_MakeEnvelope($2, $3, $4, $5, 4326)
       )
       ${kindClause}`,
    [date, bounds.west, bounds.south, bounds.east, bounds.north],
  )
  const infra = new Map(result.rows.map((row) => [row.payload.id, row.payload]))
  const visibleIds = [...infra.keys()]
  const routeResult = await pool.query<{ payload: RouteEntity }>(
        `SELECT payload
         FROM network_routes
         WHERE (segment_ids && $1::text[] OR ST_Intersects(geom, ST_MakeEnvelope($3, $4, $5, $6, 4326)))
           AND (valid_from IS NULL OR valid_from <= $2)
           AND (valid_to IS NULL OR valid_to >= $2)`,
        [visibleIds, date, bounds.west, bounds.south, bounds.east, bounds.north],
      )
  const routes = new Map(routeResult.rows.map((row) => [row.payload.id, row.payload]))
  if (workspaceId !== 'main') {
    const overlay = await pool.query<{ operations: StoredOperations }>(
      `SELECT operations FROM changesets
       WHERE workspace_id = $1 AND status = 'published' AND effective_on <= $2
       ORDER BY effective_on, created_at`,
      [workspaceId, date],
    )
    for (const change of overlay.rows) {
      for (const id of change.operations.removeInfra) infra.delete(id)
      for (const entity of change.operations.upsertInfra) {
        if (infraAliveAt(entity, date) && entityInBounds(entity, bounds)) infra.set(entity.id, entity)
        else infra.delete(entity.id)
      }
      for (const id of change.operations.removeRoutes) routes.delete(id)
      for (const route of change.operations.upsertRoutes) {
        if (infraAliveAt(route, date) && (entityInBounds(route, bounds) || route.segmentIds.some((id) => infra.has(id)))) routes.set(route.id, route)
        else routes.delete(route.id)
      }
    }
  }
  const scopes = [...new Set([...result.rows.map((row) => row.source_scope), 'world'])]
  const chronicles = []
  for (const scope of scopes) {
    chronicles.push(...projectEvents(await loadEvents(scope), date).chronicles.values())
  }

  const state = { infra, routes, chronicles: new Map(chronicles.map((item) => [item.id, item])) }
  return {
    scope: 'viewport',
    bounds,
    zoom,
    date,
    infra: [...infra.values()],
    routes: [...routes.values()],
    chronicles: chronicles.sort((left, right) => left.date.localeCompare(right.date)),
    features: renderFeatures(state, undefined, date),
  }
}

type StoredOperations = {
  upsertInfra: InfraEntity[]
  removeInfra: string[]
  upsertRoutes: RouteEntity[]
  removeRoutes: string[]
}

async function publishOperations(
  operations: StoredOperations,
  date: string,
  actor: string,
  article?: { mode: TransportMode; title: string; summary: string },
) {
  const ids = [
    ...operations.upsertInfra.map((item) => item.id),
    ...operations.upsertRoutes.map((item) => item.id),
    ...operations.removeInfra,
    ...operations.removeRoutes,
  ]
  const existing = ids.length
    ? await pool.query<{ id: string; source_scope: string }>(
        `SELECT id, source_scope FROM network_infra WHERE id = ANY($1::text[])
         UNION ALL SELECT id, source_scope FROM network_routes WHERE id = ANY($1::text[])`,
        [ids],
      )
    : { rows: [] as { id: string; source_scope: string }[] }
  const scopes = new Map(existing.rows.map((row) => [row.id, row.source_scope]))
  const touched = new Set<string>()
  const events: Array<{ type: string; scope: string; payload: Record<string, unknown> }> = []
  const add = (type: string, id: string, payload: Record<string, unknown>) => {
    const scope = scopes.get(id) ?? 'world'
    touched.add(scope)
    events.push({ type, scope, payload })
  }
  for (const entity of operations.upsertInfra) add('infra.upsert', entity.id, entity as unknown as Record<string, unknown>)
  for (const id of operations.removeInfra) add('infra.removed', id, { id })
  for (const route of operations.upsertRoutes) add('route.upsert', route.id, route as unknown as Record<string, unknown>)
  for (const id of operations.removeRoutes) add('route.removed', id, { id })
  if (article?.title) {
    touched.add('world')
    events.push({
      type: 'chronicle.upsert',
      scope: 'world',
      payload: {
        id: `world-${article.mode}-${date}`,
        city: 'world',
        mode: article.mode,
        date,
        title: article.title,
        summary: article.summary,
        network: '',
      },
    })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const event of events) {
      await client.query(
        `INSERT INTO events (type, occurred_on, city_id, scope_id, actor, payload)
         VALUES ($1, $2, NULL, $3, $4, $5::jsonb)`,
        [event.type, date, event.scope, actor, JSON.stringify(event.payload)],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  for (const scope of touched) await syncSpatialProjection(scope)
  return events.length
}

function validatedInfra(input: unknown, way: TransportWay, fallbackSince: string): InfraEntity[] {
  if (!Array.isArray(input)) {
    throw new Error('infra')
  }
  const trackName = way === 'road' ? 'Улица' : 'Путь'
  const trackColor = way === 'road' ? '#6b746c' : '#8b9098'
  return input.map((item, index) => {
    const entity = item as Partial<InfraEntity>
    if (!entity.id || typeof entity.id !== 'string') {
      throw new Error(`infra ${index}: id`)
    }
    if (entity.kind !== 'track' && entity.kind !== 'stop' && entity.kind !== 'node') {
      throw new Error(`infra ${index}: kind`)
    }
    if (!entity.geometry?.type || entity.geometry.coordinates == null) {
      throw new Error(`infra ${index}: geometry`)
    }
    if (
      entity.kind === 'track' &&
      entity.geometry.type !== 'LineString' &&
      entity.geometry.type !== 'MultiLineString'
    ) {
      throw new Error(`infra ${index}: track geometry`)
    }
    if (entity.kind === 'stop' && entity.geometry.type !== 'Point') {
      throw new Error(`infra ${index}: stop geometry`)
    }
    const nodeKind = entity.kind === 'node' ? asNodeKind(entity.nodeKind) : undefined
    if (entity.kind === 'node') {
      if (!nodeKind) {
        throw new Error(`infra ${index}: nodeKind`)
      }
      if (way === 'road' && (nodeKind === 'wye' || nodeKind === 'crossover' || nodeKind === 'portal')) {
        throw new Error(`infra ${index}: nodeKind`)
      }
      const wantsLine = nodeLineKinds.has(nodeKind)
      if (
        wantsLine &&
        entity.geometry.type !== 'LineString' &&
        entity.geometry.type !== 'MultiLineString'
      ) {
        throw new Error(`infra ${index}: node geometry`)
      }
      if (!wantsLine && entity.geometry.type !== 'Point') {
        throw new Error(`infra ${index}: node geometry`)
      }
    }
    const since = asDate(entity.since) ?? fallbackSince
    const until = asDate(entity.until)
    if (until && until < since) {
      throw new Error(`infra ${index}: until`)
    }
    const grade = way === 'rail' ? asGrade(entity.grade) ?? 'surface' : undefined
    const level = way === 'rail' && grade === 'tunnel' ? asLevel(entity.level) ?? -1 : undefined
    return {
      id: entity.id,
      kind: entity.kind,
      way,
      mode: entity.mode && modes.has(entity.mode) && wayOf(entity.mode) === way ? entity.mode : undefined,
      gauge: way === 'rail' ? asGauge(entity.gauge) : undefined,
      grade,
      level,
      since,
      until,
      name: entity.name?.trim() || (entity.kind === 'track' ? trackName : entity.kind === 'stop' ? 'Остановка' : 'Узел'),
      color: entity.color?.trim() || (entity.kind === 'track' ? trackColor : '#c45c26'),
      trackForm: asTrackForm(entity.trackForm),
      nodeKind,
      geometry: entity.geometry,
    }
  })
}

function validatedRoutes(input: unknown, mode: TransportMode, fallbackSince: string): RouteEntity[] {
  if (!Array.isArray(input)) {
    throw new Error('routes')
  }
  return input.map((item, index) => {
    const entity = item as Partial<RouteEntity>
    const number = entity.number?.trim()
    if (!entity.id || typeof entity.id !== 'string') {
      throw new Error(`route ${index}: id`)
    }
    if (!number) {
      throw new Error(`route ${index}: number`)
    }
    const segmentIds = Array.isArray(entity.segmentIds)
      ? entity.segmentIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : []
    const road = mode === 'bus'
    const geometry = entity.geometry
    if (road && geometry != null) {
      if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) ||
        geometry.coordinates.some((point) => !Array.isArray(point) || point.length !== 2 ||
          point.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) {
        throw new Error(`route ${index}: geometry`)
      }
    }
    const since = asDate(entity.since) ?? fallbackSince
    const until = asDate(entity.until)
    if (until && until < since) {
      throw new Error(`route ${index}: until`)
    }
    return {
      id: entity.id,
      mode,
      number,
      name: entity.name?.trim() || `Route №${number}`,
      color: entity.color?.trim() || '#c45c26',
      segmentIds,
      geometry: road ? geometry : undefined,
      since,
      until,
    }
  })
}

async function networkPayload(snapshotId: string) {
  const meta = await pool.query<{ city: string; mode: string }>(
    `SELECT city_id AS city, mode FROM snapshots WHERE id = $1`,
    [snapshotId],
  )
  const snapshot = meta.rows[0]
  const features = await pool.query(
    `SELECT f.kind, f.line_id AS "lineId", f.name, f.color, f.track_form AS "trackForm",
            f.node_kind AS "nodeKind", ST_AsGeoJSON(f.geom)::json AS geometry
     FROM features f
     WHERE f.snapshot_id = $1
     ORDER BY f.id`,
    [snapshotId],
  )
  return {
    type: 'FeatureCollection',
    features: features.rows.map((row) => ({
      type: 'Feature',
      properties: {
        kind: row.kind,
        mode: snapshot?.mode ?? 'tram',
        lineId: row.lineId,
        number: snapshot ? numberFromLineId(row.lineId, snapshot.city, snapshot.mode) : row.lineId,
        name: row.name,
        color: row.color,
        trackForm: row.trackForm ?? 'double',
        nodeKind: row.nodeKind ?? undefined,
      },
      geometry: row.geometry,
    })),
  }
}

function validatedFeatures(input: SnapshotInput, city: string, mode: string) {
  const features = input.features ?? []
  return features.map((feature, index) => {
    const kind = feature.properties?.kind
    const geometry = feature.geometry
    if (kind !== 'track' && kind !== 'stop' && kind !== 'node') {
      throw new Error(`feature ${index}: kind`)
    }
    if (!geometry?.type || geometry.coordinates == null) {
      throw new Error(`feature ${index}: geometry`)
    }
    const number = (feature.properties?.number ?? '').trim() || numberFromLineId(feature.properties?.lineId ?? '', city, mode)
    const lineId = lineKey(city, mode, number)
    const trackForm = feature.properties?.trackForm ?? (mode === 'metro' ? 'double' : 'single_both')
    if (!trackForms.has(trackForm)) {
      throw new Error(`feature ${index}: trackForm`)
    }
    const nodeKind = feature.properties?.nodeKind
    if (kind === 'track' && geometry.type !== 'LineString' && geometry.type !== 'MultiLineString') {
      throw new Error(`feature ${index}: track geometry`)
    }
    if (kind === 'stop' && geometry.type !== 'Point') {
      throw new Error(`feature ${index}: stop geometry`)
    }
    if (kind === 'node') {
      if (!nodeKind || !nodeKinds.has(nodeKind)) {
        throw new Error(`feature ${index}: nodeKind`)
      }
      const wantsLine = nodeLineKinds.has(nodeKind)
      if (wantsLine && geometry.type !== 'LineString' && geometry.type !== 'MultiLineString') {
        throw new Error(`feature ${index}: node geometry`)
      }
      if (!wantsLine && geometry.type !== 'Point') {
        throw new Error(`feature ${index}: node geometry`)
      }
    }
    const defaultName =
      kind === 'track' ? `Маршрут №${number}` : kind === 'stop' ? 'Остановка' : 'Узел'
    return {
      kind,
      lineId,
      number,
      name: feature.properties?.name?.trim() || defaultName,
      color: feature.properties?.color?.trim() || '#c45c26',
      trackForm,
      nodeKind: kind === 'node' ? nodeKind : null,
      mode,
      geometry,
    }
  })
}

async function writeSnapshot(id: string, input: SnapshotInput, existingId?: string) {
  const city = input.city?.trim()
  const mode = input.mode?.trim()
  const date = input.date?.trim()
  const title = input.title?.trim()
  const summary = input.summary ?? ''
  if (!city || !mode || !date || !title) {
    throw new Error('city, mode, date, title')
  }
  if (!modes.has(mode)) {
    throw new Error('mode')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date')
  }

  const cityRow = await pool.query('SELECT id FROM cities WHERE id = $1', [city])
  if (!cityRow.rowCount) {
    throw new Error('city')
  }

  const features = validatedFeatures(input, city, mode)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (existingId && existingId !== id) {
      await client.query('DELETE FROM snapshots WHERE id = $1', [existingId])
    }
    await client.query(
      `INSERT INTO snapshots (id, city_id, mode, on_date, title, summary)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         city_id = EXCLUDED.city_id,
         mode = EXCLUDED.mode,
         on_date = EXCLUDED.on_date,
         title = EXCLUDED.title,
         summary = EXCLUDED.summary`,
      [id, city, mode, date, title, summary],
    )
    const lineRows = new Map<string, { number: string; name: string; color: string }>()
    for (const feature of features) {
      const current = lineRows.get(feature.lineId)
      if (!current || feature.kind === 'track') {
        lineRows.set(feature.lineId, {
          number: feature.number,
          name: feature.kind === 'track' ? feature.name : (current?.name ?? feature.name),
          color: feature.color,
        })
      }
    }
    for (const [lineId, line] of lineRows) {
      await client.query(
        `INSERT INTO lines (id, city_id, mode, number, name, color)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           color = EXCLUDED.color,
           number = EXCLUDED.number`,
        [lineId, city, mode, line.number, line.name, line.color],
      )
    }
    await client.query('DELETE FROM features WHERE snapshot_id = $1', [id])
    for (const feature of features) {
      await client.query(
        `INSERT INTO features (snapshot_id, kind, line_id, name, color, track_form, node_kind, geom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_GeomFromGeoJSON($8), 4326))`,
        [
          id,
          feature.kind,
          feature.lineId,
          feature.name,
          feature.color,
          feature.trackForm,
          feature.nodeKind,
          JSON.stringify(feature.geometry),
        ],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'GET' && path === '/api/health') {
      await pool.query('SELECT 1')
      send(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/api/catalog') {
      send(res, 200, await catalogPayload())
      return
    }

    if (method === 'GET' && path === '/api/state') {
      const city = url.searchParams.get('city')?.trim() ?? ''
      const date = url.searchParams.get('date')?.trim() ?? ''
      try {
        send(res, 200, await statePayload(city, date))
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : 'bad request' })
      }
      return
    }

    if (method === 'GET' && path === '/api/map') {
      const bounds = asBounds(url.searchParams.get('bbox') ?? '')
      const date = url.searchParams.get('date')?.trim() ?? ''
      const zoom = Number(url.searchParams.get('zoom'))
      if (!bounds || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(zoom) || zoom < 0 || zoom > 22) {
        send(res, 400, { error: 'bbox, date, zoom' })
        return
      }
      const workspaceId = url.searchParams.get('workspace')?.trim() || 'main'
      if (workspaceId !== 'main') {
        const viewer = await userFromRequest(pool, req)
        const workspace = await pool.query(
          `SELECT 1 FROM workspaces
           WHERE id = $1 AND kind = 'scenario'
             AND (visibility IN ('public', 'link') OR owner_id = $2)`,
          [workspaceId, viewer?.id ?? null],
        )
        if (!workspace.rowCount) {
          send(res, 404, { error: 'workspace' })
          return
        }
      }
      send(res, 200, await mapPayload(bounds, date, zoom, url.searchParams.get('detail') === 'editor', workspaceId))
      return
    }

    if (method === 'GET' && path === '/api/export.svg') {
      const bounds = asBounds(url.searchParams.get('bbox') ?? '')
      const date = url.searchParams.get('date')?.trim() ?? ''
      const zoom = Math.max(0, Math.min(22, Number(url.searchParams.get('zoom') ?? 12)))
      const width = Math.max(320, Math.min(4096, Number(url.searchParams.get('width') ?? 1600)))
      const height = Math.max(240, Math.min(4096, Number(url.searchParams.get('height') ?? 1000)))
      const workspaceId = url.searchParams.get('workspace')?.trim() || 'main'
      if (!bounds || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        send(res, 400, { error: 'bbox, date' })
        return
      }
      if (workspaceId !== 'main') {
        const viewer = await userFromRequest(pool, req)
        const workspace = await pool.query(
          `SELECT 1 FROM workspaces
           WHERE id = $1 AND kind = 'scenario'
             AND (visibility IN ('public', 'link') OR owner_id = $2)`,
          [workspaceId, viewer?.id ?? null],
        )
        if (!workspace.rowCount) {
          send(res, 404, { error: 'workspace' })
          return
        }
      }
      const state = await mapPayload(bounds, date, zoom, true, workspaceId)
      const enabledModes = new Set((url.searchParams.get('modes') ?? 'metro,tram,trolleybus,bus').split(',').filter((mode) => modes.has(mode as TransportMode)))
      const visibleRoutes = url.searchParams.has('routes')
        ? new Set((url.searchParams.get('routes') ?? '').split(',').filter(Boolean))
        : null
      const exportFeatures = state.features.filter((feature) => feature.properties.layer === 'route'
        ? enabledModes.has(feature.properties.mode) && (!visibleRoutes || visibleRoutes.has(feature.properties.lineId))
        : feature.properties.way === 'rail'
          ? enabledModes.has('metro') || enabledModes.has('tram')
          : enabledModes.has('trolleybus') || enabledModes.has('bus'))
      const svg = await buildMapSvg(exportFeatures, bounds, zoom, width, height, url.searchParams.get('basemap') === '1')
      res.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'content-disposition': `attachment; filename="transport-${date}.svg"`,
        'cache-control': 'no-store',
      })
      res.end(svg)
      return
    }

    const networkMatch = path.match(/^\/api\/snapshots\/([^/]+)\/network$/)
    if (method === 'GET' && networkMatch) {
      send(res, 200, await networkPayload(decodeURIComponent(networkMatch[1] ?? '')))
      return
    }

    if (method === 'GET' && path === '/api/me') {
      const user = await userFromRequest(pool, req)
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      send(res, 200, { user: { username: user.username, role: user.role, preferredLanguage: user.preferredLanguage } })
      return
    }

    if (method === 'PATCH' && path === '/api/me') {
      const user = await userFromRequest(pool, req)
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const body = await readJson<{ language?: string | null }>(req)
      const language = body.language == null ? null : body.language
      if (language !== null && language !== 'en' && language !== 'sr' && language !== 'ru') {
        send(res, 400, { error: 'language' })
        return
      }
      await pool.query('UPDATE users SET preferred_language = $1 WHERE id = $2', [language, user.id])
      send(res, 200, { user: { username: user.username, role: user.role, preferredLanguage: language } })
      return
    }

    if (method === 'POST' && path === '/api/login') {
      const body = await readJson<{ username?: string; password?: string }>(req)
      const username = body.username?.trim() ?? ''
      const password = body.password ?? ''
      const found = await pool.query<{ id: number; username: string; password_hash: string }>(
        'SELECT id, username, password_hash FROM users WHERE username = $1',
        [username],
      )
      const row = found.rows[0]
      if (!row || !(await verifyPassword(password, row.password_hash))) {
        send(res, 401, { error: 'invalid credentials' })
        return
      }
      const token = await createSession(pool, row.id)
      setCookie(res, SESSION_COOKIE, token, SESSION_MAX_AGE)
      const profile = await pool.query<{ role: string; preferredLanguage: string | null }>(
        'SELECT role, preferred_language AS "preferredLanguage" FROM users WHERE id = $1',
        [row.id],
      )
      send(res, 200, {
        user: {
          username: row.username,
          role: profile.rows[0]?.role ?? 'user',
          preferredLanguage: profile.rows[0]?.preferredLanguage ?? null,
        },
      })
      return
    }

    if (method === 'POST' && path === '/api/register') {
      const body = await readJson<{ username?: string; password?: string }>(req)
      const username = body.username?.trim() ?? ''
      const password = body.password ?? ''
      if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username) || password.length < 8) {
        send(res, 400, { error: 'username must be 3–32 characters and password at least 8 characters' })
        return
      }
      try {
        const created = await pool.query<{ id: number }>(
          `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'user') RETURNING id`,
          [username, await hashPassword(password)],
        )
        const token = await createSession(pool, created.rows[0]!.id)
        setCookie(res, SESSION_COOKIE, token, SESSION_MAX_AGE)
        send(res, 201, { user: { username, role: 'user', preferredLanguage: null } })
      } catch (error) {
        if (isUniqueViolation(error)) send(res, 409, { error: 'username is already taken' })
        else throw error
      }
      return
    }

    if (method === 'POST' && path === '/api/logout') {
      const token = cookieValue(req, SESSION_COOKIE)
      if (token) {
        await destroySession(pool, token)
      }
      clearCookie(res, SESSION_COOKIE)
      send(res, 200, { ok: true })
      return
    }

    const user = await userFromRequest(pool, req)

    if (method === 'GET' && path === '/api/users') {
      if (!user || user.role !== 'superuser') {
        send(res, 403, { error: 'superuser required' })
        return
      }
      const result = await pool.query(
        `SELECT id, username, role, preferred_language AS "preferredLanguage", created_at AS "createdAt"
         FROM users ORDER BY username`,
      )
      send(res, 200, { users: result.rows })
      return
    }

    const userRoleMatch = path.match(/^\/api\/users\/(\d+)\/role$/)
    if (method === 'PATCH' && userRoleMatch) {
      if (!user || user.role !== 'superuser') {
        send(res, 403, { error: 'superuser required' })
        return
      }
      const body = await readJson<{ role?: string }>(req)
      if (body.role !== 'user' && body.role !== 'moderator') {
        send(res, 400, { error: 'role' })
        return
      }
      const result = await pool.query(
        `UPDATE users SET role = $1 WHERE id = $2 AND role <> 'superuser' RETURNING id, username, role`,
        [body.role, Number(userRoleMatch[1])],
      )
      send(res, result.rowCount ? 200 : 404, result.rows[0] ?? { error: 'user' })
      return
    }

    if (method === 'GET' && path === '/api/workspaces') {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const result = await pool.query(
        `SELECT id, kind, title, description, visibility,
                base_workspace_id AS "baseWorkspaceId", created_at AS "createdAt"
         FROM workspaces
         WHERE id = 'main' OR owner_id = $1
         ORDER BY kind, created_at`,
        [user.id],
      )
      send(res, 200, { workspaces: result.rows })
      return
    }

    if (method === 'POST' && path === '/api/workspaces') {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const body = await readJson<{ title?: string; description?: string; visibility?: string }>(req)
      const title = body.title?.trim() ?? ''
      const visibility = ['private', 'link', 'public'].includes(body.visibility ?? '') ? body.visibility : 'private'
      if (!title) {
        send(res, 400, { error: 'title' })
        return
      }
      const id = randomUUID()
      await pool.query(
        `INSERT INTO workspaces
           (id, kind, owner_id, title, description, visibility, base_workspace_id)
         VALUES ($1, 'scenario', $2, $3, $4, $5, 'main')`,
        [id, user.id, title, body.description ?? '', visibility],
      )
      send(res, 201, { id, kind: 'scenario', title, visibility })
      return
    }

    if (method === 'GET' && path === '/api/moderation-areas') {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const result = await pool.query(
        `SELECT area.id, area.title, area.modes, ST_AsGeoJSON(area.geom)::json AS geometry,
                array_remove(array_agg(assignment.user_id), NULL) AS "userIds"
         FROM moderation_areas area
         LEFT JOIN moderation_assignments assignment ON assignment.area_id = area.id
         GROUP BY area.id ORDER BY area.title`,
      )
      send(res, 200, { areas: result.rows })
      return
    }

    if (method === 'POST' && path === '/api/moderation-areas') {
      if (!user || user.role !== 'superuser') {
        send(res, 403, { error: 'admin required' })
        return
      }
      const body = await readJson<{
        title?: string
        modes?: unknown
        geometry?: { type?: string; coordinates?: unknown }
        userIds?: unknown
      }>(req)
      const title = body.title?.trim() ?? ''
      const selectedModes = Array.isArray(body.modes)
        ? body.modes.filter((mode): mode is string => typeof mode === 'string' && modes.has(mode))
        : []
      const userIds = Array.isArray(body.userIds)
        ? body.userIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id))
        : []
      if (!title || !body.geometry || (body.geometry.type !== 'Polygon' && body.geometry.type !== 'MultiPolygon')) {
        send(res, 400, { error: 'title, geometry' })
        return
      }
      const geometry = body.geometry.type === 'Polygon'
        ? { type: 'MultiPolygon', coordinates: [body.geometry.coordinates] }
        : body.geometry
      const id = randomUUID()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO moderation_areas (id, title, modes, geom)
           VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))`,
          [id, title, selectedModes, JSON.stringify(geometry)],
        )
        for (const userId of userIds) {
          await client.query(
            'INSERT INTO moderation_assignments (area_id, user_id) VALUES ($1, $2)',
            [id, userId],
          )
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
      send(res, 201, { id, title, modes: selectedModes, userIds })
      return
    }

    if (method === 'GET' && path === '/api/changesets') {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const result = await pool.query(
        `SELECT c.id, c.workspace_id AS "workspaceId", c.status,
                c.effective_on::text AS date, c.mode, c.title, c.summary,
                c.created_at AS "createdAt", c.updated_at AS "updatedAt",
                u.username AS author,
                ($2 = 'superuser' OR EXISTS (
                  SELECT 1 FROM moderation_assignments assignment
                  JOIN moderation_areas area ON area.id = assignment.area_id
                  WHERE assignment.user_id = $1
                    AND c.bounds IS NOT NULL
                    AND ST_Covers(area.geom, c.bounds)
                    AND (cardinality(area.modes) = 0 OR c.mode = ANY(area.modes))
                )) AS "canModerate"
         FROM changesets c JOIN users u ON u.id = c.author_id
         WHERE c.author_id = $1 OR c.status = 'published' OR (
           c.status = 'submitted' AND ($2 = 'superuser' OR EXISTS (
             SELECT 1 FROM moderation_assignments assignment
             JOIN moderation_areas area ON area.id = assignment.area_id
             WHERE assignment.user_id = $1
               AND c.bounds IS NOT NULL
               AND ST_Covers(area.geom, c.bounds)
               AND (cardinality(area.modes) = 0 OR c.mode = ANY(area.modes))
           ))
         )
         ORDER BY c.updated_at DESC LIMIT 100`,
        [user.id, user.role],
      )
      send(res, 200, { changesets: result.rows })
      return
    }

    const submitMatch = path.match(/^\/api\/changesets\/([^/]+)\/submit$/)
    if (method === 'POST' && submitMatch) {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const result = await pool.query(
        `UPDATE changesets c
         SET status = CASE WHEN workspace.kind = 'scenario' THEN 'published' ELSE 'submitted' END,
             submitted_at = now(),
             published_at = CASE WHEN workspace.kind = 'scenario' THEN now() ELSE NULL END,
             updated_at = now()
         FROM workspaces workspace
         WHERE c.id = $1 AND c.author_id = $2
           AND c.status IN ('draft', 'changes_requested')
           AND workspace.id = c.workspace_id
         RETURNING c.id, c.status`,
        [decodeURIComponent(submitMatch[1] ?? ''), user.id],
      )
      send(res, result.rowCount ? 200 : 409, result.rows[0] ?? { error: 'changeset cannot be submitted' })
      return
    }

    const publishMatch = path.match(/^\/api\/changesets\/([^/]+)\/publish$/)
    if (method === 'POST' && publishMatch) {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const id = decodeURIComponent(publishMatch[1] ?? '')
      const found = await pool.query<{
        operations: StoredOperations
        date: string
        mode: TransportMode
        title: string
        summary: string
      }>(
        `SELECT operations, effective_on::text AS date, mode, title, summary
         FROM changesets WHERE id = $1 AND workspace_id = 'main' AND status = 'submitted' FOR UPDATE`,
        [id],
      )
      const change = found.rows[0]
      if (!change) {
        send(res, 409, { error: 'changeset cannot be published' })
        return
      }
      if (user.role !== 'superuser') {
        const allowed = await pool.query(
          `SELECT 1
           FROM changesets c
           JOIN moderation_areas area
             ON c.bounds IS NOT NULL
            AND ST_Covers(area.geom, c.bounds)
            AND (cardinality(area.modes) = 0 OR c.mode = ANY(area.modes))
           JOIN moderation_assignments assignment ON assignment.area_id = area.id
           WHERE c.id = $1 AND assignment.user_id = $2`,
          [id, user.id],
        )
        if (!allowed.rowCount) {
          send(res, 403, { error: 'moderation area does not cover this changeset' })
          return
        }
      }
      const eventCount = await publishOperations(change.operations, change.date, user.username, {
        mode: change.mode,
        title: change.title,
        summary: change.summary,
      })
      await pool.query(
        `UPDATE changesets SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      )
      await pool.query(
        `INSERT INTO changeset_reviews (changeset_id, reviewer_id, decision)
         VALUES ($1, $2, 'published')`,
        [id, user.id],
      )
      send(res, 200, { id, status: 'published', events: eventCount })
      return
    }

    const reviewMatch = path.match(/^\/api\/changesets\/([^/]+)\/review$/)
    if (method === 'POST' && reviewMatch) {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const id = decodeURIComponent(reviewMatch[1] ?? '')
      const body = await readJson<{ decision?: string; note?: string }>(req)
      if (body.decision !== 'changes_requested' && body.decision !== 'rejected') {
        send(res, 400, { error: 'decision' })
        return
      }
      const allowed = user.role === 'superuser' ? { rowCount: 1 } : await pool.query(
        `SELECT 1 FROM changesets c
         JOIN moderation_areas area ON c.bounds IS NOT NULL AND ST_Covers(area.geom, c.bounds)
           AND (cardinality(area.modes) = 0 OR c.mode = ANY(area.modes))
         JOIN moderation_assignments assignment ON assignment.area_id = area.id
         WHERE c.id = $1 AND c.status = 'submitted' AND assignment.user_id = $2`,
        [id, user.id],
      )
      if (!allowed.rowCount) {
        send(res, 403, { error: 'moderation area does not cover this changeset' })
        return
      }
      const result = await pool.query(
        `UPDATE changesets SET status = $1, updated_at = now()
         WHERE id = $2 AND workspace_id = 'main' AND status = 'submitted' RETURNING id, status`,
        [body.decision, id],
      )
      if (!result.rowCount) {
        send(res, 409, { error: 'changeset cannot be reviewed' })
        return
      }
      await pool.query(
        `INSERT INTO changeset_reviews (changeset_id, reviewer_id, decision, comment) VALUES ($1, $2, $3, $4)`,
        [id, user.id, body.decision, body.note?.trim() ?? ''],
      )
      send(res, 200, result.rows[0])
      return
    }

    if (method === 'POST' && path === '/api/objects/commit') {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const body = await readJson<ObjectCommitInput>(req)
      const workspaceId = body.workspaceId?.trim() || 'main'
      const workspace = await pool.query<{ id: string }>(
        `SELECT id FROM workspaces
         WHERE id = $1 AND (id = 'main' OR owner_id = $2)`,
        [workspaceId, user.id],
      )
      if (!workspace.rowCount) {
        send(res, 403, { error: 'workspace' })
        return
      }
      const date = asDate(body.date)
      const mode = body.mode && modes.has(body.mode) ? (body.mode as TransportMode) : undefined
      if (!date || !mode) {
        send(res, 400, { error: 'date, mode' })
        return
      }
      const rawInfra = Array.isArray(body.upsertInfra) ? body.upsertInfra : []
      const rawRoutes = Array.isArray(body.upsertRoutes) ? body.upsertRoutes : []
      const removeInfra = Array.isArray(body.removeInfra)
        ? body.removeInfra.filter((id): id is string => typeof id === 'string')
        : []
      const removeRoutes = Array.isArray(body.removeRoutes)
        ? body.removeRoutes.filter((id): id is string => typeof id === 'string')
        : []
      try {
        const infra = rawInfra.flatMap((item) => {
          const way = asWay((item as Partial<InfraEntity>).way)
          if (!way) throw new Error('infra way')
          return validatedInfra([item], way, date)
        })
        const routes = rawRoutes.flatMap((item) => {
          const routeMode = (item as Partial<RouteEntity>).mode
          if (!routeMode || !modes.has(routeMode)) throw new Error('route mode')
          return validatedRoutes([item], routeMode, date)
        })
        const operations = { upsertInfra: infra, removeInfra, upsertRoutes: routes, removeRoutes }
        const id = body.changeSetId?.trim() || randomUUID()
        const saved = await pool.query(
          `INSERT INTO changesets
             (id, workspace_id, author_id, status, effective_on, mode, title, summary, operations)
           VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             effective_on = EXCLUDED.effective_on,
             mode = EXCLUDED.mode,
             title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             operations = EXCLUDED.operations,
             updated_at = now()
           WHERE changesets.author_id = EXCLUDED.author_id AND changesets.status = 'draft'
           RETURNING id`,
          [id, workspaceId, user.id, date, mode, body.title?.trim() ?? '', body.summary ?? '', JSON.stringify(operations)],
        )
        if (!saved.rowCount) {
          send(res, 409, { error: 'changeset cannot be updated' })
          return
        }
        const referencedSegments = [...new Set([...removeInfra, ...routes.flatMap((route) => route.segmentIds)])]
        if (infra.length > 0 || routes.length > 0 || referencedSegments.length > 0 || removeRoutes.length > 0) {
          await pool.query(
            `WITH changed_geometries AS (
               SELECT ST_SetSRID(ST_GeomFromGeoJSON(value->'geometry'), 4326) AS geom
               FROM jsonb_array_elements($2::jsonb) AS value
               UNION ALL
               SELECT ST_SetSRID(ST_GeomFromGeoJSON(value->'geometry'), 4326) AS geom
               FROM jsonb_array_elements($5::jsonb) AS value
               WHERE value->'geometry' IS NOT NULL
                 AND jsonb_array_length(value->'geometry'->'coordinates') >= 2
               UNION ALL
               SELECT geom FROM network_infra WHERE id = ANY($3::text[])
               UNION ALL
               SELECT infra.geom
               FROM network_routes route
               CROSS JOIN LATERAL unnest(route.segment_ids) segment_id
               JOIN network_infra infra ON infra.id = segment_id
               WHERE route.id = ANY($4::text[])
             )
             UPDATE changesets
             SET bounds = (SELECT ST_Envelope(ST_Collect(geom)) FROM changed_geometries)
             WHERE id = $1`,
            [id, JSON.stringify(infra), referencedSegments, removeRoutes, JSON.stringify(routes)],
          )
        }
        send(res, 201, {
          ok: true,
          id,
          status: 'draft',
          operations: infra.length + removeInfra.length + routes.length + removeRoutes.length,
          date,
        })
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : 'bad request' })
      }
      return
    }

    if (method === 'POST' && path === '/api/commit') {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const body = await readJson<CommitInput>(req)
      const city = body.city?.trim() ?? ''
      const date = body.date?.trim() ?? ''
      const mode = body.mode?.trim() ?? ''
      const title = body.title?.trim() ?? ''
      const summary = body.summary ?? ''
      if (!city || !date || !mode) {
        send(res, 400, { error: 'city, date, mode' })
        return
      }
      if (!modes.has(mode)) {
        send(res, 400, { error: 'mode' })
        return
      }
      const transportMode = mode as TransportMode
      const way = asWay(body.way) ?? wayOf(transportMode)
      if (!ways.has(way) || wayOf(transportMode) !== way) {
        send(res, 400, { error: 'way' })
        return
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        send(res, 400, { error: 'date' })
        return
      }
      const cityRow = await pool.query('SELECT id FROM cities WHERE id = $1', [city])
      if (!cityRow.rowCount) {
        send(res, 400, { error: 'city' })
        return
      }
      try {
        const infra = validatedInfra(body.infra, way, date)
        const routes = validatedRoutes(body.routes, transportMode, date)
        const before = projectEvents(await loadEvents(city), date)
        const events = diffAndBuildEvents({
          cityId: city,
          date,
          way,
          mode: transportMode,
          actor: user.username,
          before,
          infra,
          routes,
          title,
          summary,
        })
        if (events.length > 0) {
          const client = await pool.connect()
          try {
            await client.query('BEGIN')
            for (const event of events) {
              await client.query(
                `INSERT INTO events (type, occurred_on, city_id, scope_id, actor, payload)
                 VALUES ($1, $2, $3, $3, $4, $5::jsonb)`,
                [
                  event.type,
                  event.occurredOn,
                  event.cityId,
                  event.actor,
                  JSON.stringify(event.payload),
                ],
              )
            }
            await client.query('COMMIT')
          } catch (error) {
            await client.query('ROLLBACK')
            throw error
          } finally {
            client.release()
          }
        }
        await syncSpatialProjection(city)
        send(res, 200, { ok: true, events: events.length, date })
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : 'bad request' })
      }
      return
    }

    if (method === 'POST' && path === '/api/snapshots') {
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      const body = await readJson<SnapshotInput>(req)
      const id = snapshotKey(body.city ?? '', body.mode ?? '', body.date ?? '')
        try {
          await writeSnapshot(id, body)
        } catch (error) {
          if (isUniqueViolation(error)) {
            send(res, 409, { error: 'snapshot exists' })
            return
          }
          send(res, 400, { error: error instanceof Error ? error.message : 'bad request' })
          return
        }
      send(res, 201, { id, network: `/api/snapshots/${id}/network` })
      return
    }

    const snapshotMatch = path.match(/^\/api\/snapshots\/([^/]+)$/)
    if (snapshotMatch) {
      const snapshotId = decodeURIComponent(snapshotMatch[1] ?? '')
      if (!user) {
        send(res, 401, { error: 'unauthorized' })
        return
      }
      if (method === 'PUT') {
        const body = await readJson<SnapshotInput>(req)
        const nextId = snapshotKey(body.city ?? '', body.mode ?? '', body.date ?? '')
        try {
          await writeSnapshot(nextId, body, snapshotId)
        } catch (error) {
          if (isUniqueViolation(error)) {
            send(res, 409, { error: 'snapshot exists' })
            return
          }
          send(res, 400, { error: error instanceof Error ? error.message : 'bad request' })
          return
        }
        send(res, 200, { id: nextId, network: `/api/snapshots/${nextId}/network` })
        return
      }
      if (method === 'DELETE') {
        const deleted = await pool.query('DELETE FROM snapshots WHERE id = $1', [snapshotId])
        send(res, deleted.rowCount ? 200 : 404, deleted.rowCount ? { ok: true } : { error: 'not found' })
        return
      }
    }

    send(res, 404, { error: 'not found' })
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : 'server error' })
  }
})

await waitForDatabase()
await migrateAndSeed(pool, seedDir)
await syncAllSpatialProjections()
server.listen(port, '0.0.0.0', () => {
  console.log(`api listening on ${port}`)
})
