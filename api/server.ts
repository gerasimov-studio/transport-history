import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSession,
  destroySession,
  userFromRequest,
  verifyPassword,
} from './auth.ts'
import { clearCookie, cookieValue, readJson, send, setCookie } from './http.ts'
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
     WHERE city_id = $1
     ORDER BY occurred_on, id`,
    [city],
  )
  return result.rows
}

async function catalogFromEvents() {
  const cities = await pool.query(
    `SELECT id, name, aliases, lat, lng, zoom, min_zoom AS "minZoom", max_zoom AS "maxZoom"
     FROM cities ORDER BY id`,
  )
  const codes = await pool.query('SELECT code, mode FROM mode_codes')
  const dateSet = new Set<string>()
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
    const since = asDate(entity.since) ?? fallbackSince
    const until = asDate(entity.until)
    if (until && until < since) {
      throw new Error(`route ${index}: until`)
    }
    return {
      id: entity.id,
      mode,
      number,
      name: entity.name?.trim() || `Маршрут №${number}`,
      color: entity.color?.trim() || '#c45c26',
      segmentIds,
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
      send(res, 200, { user: { username: user.username } })
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
      send(res, 200, { user: { username: row.username } })
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
                `INSERT INTO events (type, occurred_on, city_id, actor, payload)
                 VALUES ($1, $2, $3, $4, $5::jsonb)`,
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
server.listen(port, '0.0.0.0', () => {
  console.log(`api listening on ${port}`)
})
