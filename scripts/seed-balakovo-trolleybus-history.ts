import { readFileSync } from 'node:fs'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

type Point = [number, number]
type Wire = { id: number; coordinates: Point[] }
type Route = { ref: string; name: string; wayIds: number[] }
type LineString = { type: 'LineString'; coordinates: Point[] }
type Event = { type: string; date: string; payload: Record<string, unknown> }

const wires = (JSON.parse(readFileSync(new URL('../db/seed/balakovo-trolley-wire-osm.json', import.meta.url), 'utf8')) as { ways: Wire[] }).ways
const routes = (JSON.parse(readFileSync(new URL('../db/seed/balakovo-trolley-routes-osm.json', import.meta.url), 'utf8')) as { routes: Route[] }).routes
const route12Autonomous = JSON.parse(readFileSync(new URL('../db/seed/balakovo-route-12-autonomous.json', import.meta.url), 'utf8')) as LineString
const pool = new pg.Pool({ connectionString: databaseUrl })
const actor = 'seed:balakovo-trolleybus-history-v1'
const city = 'balakovo'
const events: Event[] = []
const add = (type: string, date: string, payload: Record<string, unknown>) => events.push({ type, date, payload })
const chronicle = (date: string, title: string, summary: string) => add('chronicle.upsert', date, {
  id: `balakovo-trolleybus-${date}`, city, mode: 'trolleybus', date, title, summary, network: '',
})
const infraId = (id: number) => `balakovo-trolley-wire-osm-${id}`
const routeSince: Record<string, string> = {
  '2': '1968-01-01',
  '4': '1983-11-16',
  '5': '1993-01-01',
  '5а': '1993-01-01',
  '6': '1993-01-01',
  '11': '2000-01-01',
}
const routeUntil: Record<string, string | undefined> = {
  '5': '2024-08-31',
  '5а': '2024-08-31',
}
const firstLineWayIds = new Set(routes.find((route) => route.ref === '2')?.wayIds.slice(0, 10) ?? [])
const routesByWire = new Map<number, string[]>()
for (const route of routes) {
  for (const wayId of route.wayIds) {
    const memberships = routesByWire.get(wayId) ?? []
    memberships.push(route.ref)
    routesByWire.set(wayId, memberships)
  }
}

const routeFive = routes.find((route) => route.ref === '5')
if (routeFive) {
  add('route.upsert', '2024-09-01', {
    id: 'balakovo-trolleybus-12-mixed', mode: 'trolleybus', number: '12',
    name: '7-й микрорайон — МСЧ-156 · кольцевой', color: '#2e7d4f',
    segmentIds: [], since: '2024-09-01',
    legs: [
      { type: 'wire', segmentIds: routeFive.wayIds.slice(0, 62).map(infraId) },
      { type: 'autonomous', geometry: route12Autonomous },
    ],
  })
}

chronicle('1967-11-03', 'Первый балаковский троллейбус', 'Первый троллейбус прошёл по линии «1-й микрорайон — комбинат химволокна» 3 ноября 1967 года. Регулярное пассажирское движение началось 18 ноября. Историческая трасса показана приблизительно по сохранившемуся транспортному коридору.')
chronicle('1968-01-01', 'Развитие городской линии', 'После строительства шлюзового моста появился маршрут «кинотеатр „Космос“ — комбинат химволокна». Точная дата открытия требует уточнения.')
chronicle('1982-12-22', 'Линия к Балаковской АЭС', 'Открыт маршрут №3, связавший город со строительной площадкой атомной электростанции.')
chronicle('1983-11-16', 'Маршрут к Балаковорезинотехнике', 'Открыт маршрут №4 между 8-м микрорайоном и производственным объединением «Балаковорезинотехника».')
chronicle('1993-01-01', 'Второе троллейбусное депо', 'На другом конце быстро растущей сети открылось второе депо, рассчитанное на 50 машин.')
chronicle('2004-01-01', 'Закрытие второго депо', 'Из-за финансовых проблем предприятие закрыло троллейбусное депо №2.')
chronicle('2024-09-01', 'Новые кольцевые маршруты', 'Начали работу маршруты №12 и №12А с троллейбусами увеличенного автономного хода. Точная карта контактной сети и маршрутных коридоров ниже основана на актуальной разметке OpenStreetMap.')

for (const wire of wires) {
  const memberships = routesByWire.get(wire.id) ?? []
  const since = firstLineWayIds.has(wire.id) ? '1967-11-03' : memberships
    .map((ref) => routeSince[ref])
    .filter((date): date is string => Boolean(date))
    .sort()[0] ?? '2024-09-01'
  add('infra.upsert', '2024-09-01', {
    id: infraId(wire.id), kind: 'track', way: 'road', mode: 'trolleybus', since,
    name: `Контактная сеть · OSM ${wire.id}`, color: '#2e7d4f', trackForm: 'single_both',
    geometry: { type: 'LineString', coordinates: wire.coordinates },
  })
}
for (const route of routes) {
  add('route.upsert', '2024-09-01', {
    id: `balakovo-trolleybus-${route.ref}-osm`, mode: 'trolleybus', number: route.ref,
    name: route.name, color: '#2e7d4f', segmentIds: route.wayIds.map(infraId),
    since: routeSince[route.ref] ?? '2024-09-01', until: routeUntil[route.ref],
  })
}

const routeTwo = routes.find((route) => route.ref === '2')
if (routeTwo) {
  add('route.upsert', '1967-11-03', {
    id: 'balakovo-trolleybus-1-historical', mode: 'trolleybus', number: '1',
    name: '1-й микрорайон — Химволокно · приблизительная трасса', color: '#2e7d4f',
    segmentIds: routeTwo.wayIds.slice(0, 10).map(infraId), since: '1967-11-03', until: '1967-12-31',
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
