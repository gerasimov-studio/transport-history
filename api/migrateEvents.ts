import type pg from 'pg'
import {
  asNodeKind,
  asTrackForm,
  defaultGauge,
  migratedInfraId,
  migratedRouteId,
  type FeatureKind,
  type InfraEntity,
  type RouteEntity,
  type StoredEvent,
  type TransportMode,
} from './project.ts'

export async function migrateLegacySnapshotsToEvents(pool: pg.Pool) {
  const existing = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM events')
  if ((existing.rows[0]?.n ?? 0) > 0) {
    return
  }

  const snapshots = await pool.query<{
    id: string
    city: string
    mode: TransportMode
    date: string
    title: string
    summary: string
  }>(
    `SELECT id, city_id AS city, mode, on_date::text AS date, title, summary
     FROM snapshots ORDER BY on_date, mode, id`,
  )
  if (snapshots.rowCount === 0) {
    return
  }

  const features = await pool.query<{
    id: number
    snapshotId: string
    kind: FeatureKind
    lineId: string
    name: string
    color: string
    trackForm: string
    nodeKind: string | null
    geometry: unknown
  }>(
    `SELECT id, snapshot_id AS "snapshotId", kind, line_id AS "lineId", name, color,
            track_form AS "trackForm", node_kind AS "nodeKind",
            ST_AsGeoJSON(geom)::json AS geometry
     FROM features ORDER BY id`,
  )

  const bySnapshot = new Map<string, typeof features.rows>()
  for (const feature of features.rows) {
    const list = bySnapshot.get(feature.snapshotId) ?? []
    list.push(feature)
    bySnapshot.set(feature.snapshotId, list)
  }

  const events: StoredEvent[] = []
  for (const snapshot of snapshots.rows) {
    const rows = bySnapshot.get(snapshot.id) ?? []
    const segmentsByNumber = new Map<string, { ids: string[]; name: string; color: string }>()
    for (const row of rows) {
      const number = numberFromLineId(row.lineId, snapshot.city, snapshot.mode)
      const infra: InfraEntity = {
        id: migratedInfraId(snapshot.city, snapshot.mode, row.kind, row.id),
        kind: row.kind,
        way: snapshot.mode === 'metro' || snapshot.mode === 'tram' ? 'rail' : 'road',
        gauge: snapshot.mode === 'metro' || snapshot.mode === 'tram' ? defaultGauge(snapshot.mode) : undefined,
        name: row.name,
        color: row.kind === 'track' ? '#8b9098' : row.color,
        trackForm: asTrackForm(row.trackForm, snapshot.mode),
        nodeKind: asNodeKind(row.nodeKind),
        geometry: row.geometry as InfraEntity['geometry'],
      }
      events.push({
        type: 'infra.upsert',
        occurredOn: snapshot.date,
        cityId: snapshot.city,
        actor: 'migration',
        payload: infra as unknown as Record<string, unknown>,
      })
      if (row.kind === 'track') {
        const current = segmentsByNumber.get(number) ?? {
          ids: [],
          name: row.name,
          color: row.color,
        }
        current.ids.push(infra.id)
        current.name = row.name
        current.color = row.color
        segmentsByNumber.set(number, current)
      }
    }
    for (const [number, meta] of segmentsByNumber) {
      const route: RouteEntity = {
        id: migratedRouteId(snapshot.city, snapshot.mode, number),
        mode: snapshot.mode,
        number,
        name: meta.name,
        color: meta.color,
        segmentIds: meta.ids,
      }
      events.push({
        type: 'route.upsert',
        occurredOn: snapshot.date,
        cityId: snapshot.city,
        actor: 'migration',
        payload: route as unknown as Record<string, unknown>,
      })
    }
    events.push({
      type: 'chronicle.upsert',
      occurredOn: snapshot.date,
      cityId: snapshot.city,
      actor: 'migration',
      payload: {
        id: snapshot.id,
        city: snapshot.city,
        mode: snapshot.mode,
        date: snapshot.date,
        title: snapshot.title,
        summary: snapshot.summary,
        network: '',
      },
    })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const event of events) {
      await client.query(
        `INSERT INTO events (type, occurred_on, city_id, actor, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [event.type, event.occurredOn, event.cityId, event.actor, JSON.stringify(event.payload)],
      )
    }
    await client.query('COMMIT')
    console.log('migrated', events.length, 'events from snapshots')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function numberFromLineId(lineId: string, city: string, mode: string) {
  const prefix = `${city}-${mode}-`
  if (lineId.startsWith(prefix)) {
    return lineId.slice(prefix.length)
  }
  return lineId.replace(/^(tm-|line-)/, '') || '1'
}
