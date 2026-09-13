import { readFileSync } from 'node:fs'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

type Point = [number, number]
type Wire = { id: number; coordinates: Point[] }
type Route = { ref: string; name: string; wayIds: number[] }
type Event = { type: string; date: string; payload: Record<string, unknown> }

const wires = (JSON.parse(readFileSync(new URL('../db/seed/balakovo-trolley-wire-osm.json', import.meta.url), 'utf8')) as { ways: Wire[] }).ways
const routes = (JSON.parse(readFileSync(new URL('../db/seed/balakovo-trolley-routes-osm.json', import.meta.url), 'utf8')) as { routes: Route[] }).routes
const pool = new pg.Pool({ connectionString: databaseUrl })
const actor = 'seed:balakovo-trolleybus-history-v1'
const city = 'balakovo'
const events: Event[] = []
const add = (type: string, date: string, payload: Record<string, unknown>) => events.push({ type, date, payload })
const chronicle = (date: string, title: string, summary: string) => add('chronicle.upsert', date, {
  id: `balakovo-trolleybus-${date}`, city, mode: 'trolleybus', date, title, summary, network: '',
})
const infraId = (id: number) => `balakovo-trolley-wire-osm-${id}`

chronicle('1967-11-03', 'Первый балаковский троллейбус', 'Первый троллейбус прошёл по линии «1-й микрорайон — комбинат химволокна» 3 ноября 1967 года. Регулярное пассажирское движение началось 18 ноября.')
chronicle('1982-12-22', 'Линия к Балаковской АЭС', 'Открыт маршрут №3, связавший город со строительной площадкой атомной электростанции.')
chronicle('1983-11-16', 'Маршрут к Балаковорезинотехнике', 'Открыт маршрут №4 между 8-м микрорайоном и производственным объединением «Балаковорезинотехника».')
chronicle('1993-01-01', 'Второе троллейбусное депо', 'На другом конце быстро растущей сети открылось второе депо, рассчитанное на 50 машин.')
chronicle('2004-01-01', 'Закрытие второго депо', 'Из-за финансовых проблем предприятие закрыло троллейбусное депо №2.')
chronicle('2024-09-01', 'Новые кольцевые маршруты', 'Начали работу маршруты №12 и №12А с троллейбусами увеличенного автономного хода. Точная карта контактной сети и маршрутных коридоров ниже основана на актуальной разметке OpenStreetMap.')

for (const wire of wires) {
  add('infra.upsert', '2024-09-01', {
    id: infraId(wire.id), kind: 'track', way: 'road', mode: 'trolleybus', since: '2024-09-01',
    name: `Контактная сеть · OSM ${wire.id}`, color: '#2e7d4f', trackForm: 'single_both',
    geometry: { type: 'LineString', coordinates: wire.coordinates },
  })
}
for (const route of routes) {
  add('route.upsert', '2024-09-01', {
    id: `balakovo-trolleybus-${route.ref}-osm`, mode: 'trolleybus', number: route.ref,
    name: route.name, color: '#2e7d4f', segmentIds: route.wayIds.map(infraId), since: '2024-09-01',
  })
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query(
    `INSERT INTO cities (id, name, aliases, lat, lng, zoom, min_zoom, max_zoom)
     VALUES ($1, $2, $3, $4, $5, 13, 2, 22)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, aliases = EXCLUDED.aliases,
       lat = EXCLUDED.lat, lng = EXCLUDED.lng, zoom = EXCLUDED.zoom, min_zoom = EXCLUDED.min_zoom,
       max_zoom = EXCLUDED.max_zoom`,
    [city, 'Balakovo', ['Балаково'], 52.0223, 47.7828],
  )
  await client.query('DELETE FROM events WHERE actor = $1', [actor])
  for (const event of events) {
    await client.query(
      `INSERT INTO events (type, occurred_on, city_id, scope_id, actor, payload)
       VALUES ($1, $2, $3, $3, $4, $5::jsonb)`,
      [event.type, event.date, city, actor, JSON.stringify(event.payload)],
    )
  }
  await client.query('COMMIT')
  console.log(`seeded ${events.length} Balakovo trolleybus history events`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
