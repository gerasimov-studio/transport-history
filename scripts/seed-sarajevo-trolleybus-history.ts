import { readFileSync } from 'node:fs'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

type Point = [number, number]
type Wire = { id: number; coordinates: Point[] }
type Route = { ref: string; name: string; wayIds: number[] }
type Event = { type: string; date: string; payload: Record<string, unknown> }

const wires = (JSON.parse(readFileSync(new URL('../db/seed/sarajevo-trolley-wire-osm.json', import.meta.url), 'utf8')) as { ways: Wire[] }).ways
const routes = (JSON.parse(readFileSync(new URL('../db/seed/sarajevo-trolley-routes-osm.json', import.meta.url), 'utf8')) as { routes: Route[] }).routes
const pool = new pg.Pool({ connectionString: databaseUrl })
const actor = 'seed:sarajevo-trolleybus-history-v1'
const city = 'sarajevo'
const events: Event[] = []
const add = (type: string, date: string, payload: Record<string, unknown>) => events.push({ type, date, payload })
const infraId = (id: number) => `sarajevo-trolley-wire-osm-${id}`

for (const wire of wires) {
  add('infra.upsert', '1984-11-23', {
    id: infraId(wire.id), kind: 'track', way: 'road', mode: 'trolleybus', since: '1984-11-23',
    name: `Kontaktna mreža · OSM ${wire.id}`, color: '#2e7d4f', trackForm: 'single_both',
    geometry: { type: 'LineString', coordinates: wire.coordinates },
  })
}

for (const route of routes) {
  const segmentIds = route.wayIds.map(infraId)
  add('route.upsert', '1984-11-23', {
    id: `sarajevo-trolleybus-${route.ref}-prewar`, mode: 'trolleybus', number: route.ref,
    name: route.name, color: '#2e7d4f', segmentIds, since: '1984-11-23', until: '1992-04-05',
  })
  add('route.upsert', '1995-11-27', {
    id: `sarajevo-trolleybus-${route.ref}-restored`, mode: 'trolleybus', number: route.ref,
    name: route.name, color: '#2e7d4f', segmentIds, since: '1995-11-27',
  })
}

add('chronicle.upsert', '1984-11-23', {
  id: 'sarajevo-trolleybus-1984', city, mode: 'trolleybus', date: '1984-11-23',
  title: 'Otvoren trolejbuski saobraćaj',
  summary: 'Sarajevski trolejbus uveden je u godini Zimskih olimpijskih igara radi povezivanja naselja na lijevoj obali Miljacke. Prikaz kontaktne mreže koristi preciznu savremenu OSM geometriju kao prezentacijsku rekonstrukciju.', network: '',
})
add('chronicle.upsert', '1992-04-06', {
  id: 'sarajevo-trolleybus-1992', city, mode: 'trolleybus', date: '1992-04-06',
  title: 'Prekid rada tokom opsade',
  summary: 'Trolejbuski sistem prestao je raditi tokom rata; kontaktna mreža i vozila bili su gotovo potpuno uništeni.', network: '',
})
add('chronicle.upsert', '1995-11-27', {
  id: 'sarajevo-trolleybus-1995', city, mode: 'trolleybus', date: '1995-11-27',
  title: 'Obnova trolejbuske mreže',
  summary: 'Nakon rata obnovljen je trolejbuski saobraćaj. Na karti su prikazani koridori linija 101, 102, 103, 105, 107 i 108 prema savremenim podacima.', network: '',
})

const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query('DELETE FROM events WHERE actor = $1', [actor])
  for (const event of events) {
    await client.query(
      `INSERT INTO events (type, occurred_on, city_id, scope_id, actor, payload)
       VALUES ($1, $2, $3, $3, $4, $5::jsonb)`,
      [event.type, event.date, city, actor, JSON.stringify(event.payload)],
    )
  }
  await client.query('COMMIT')
  console.log(`seeded ${events.length} Sarajevo trolleybus history events`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
