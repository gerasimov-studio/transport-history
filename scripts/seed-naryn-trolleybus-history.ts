import { readFileSync } from 'node:fs'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

type LineString = { type: 'LineString'; coordinates: [number, number][] }
type Polygon = { type: 'Polygon'; coordinates: [number, number][][] }
type Event = { type: string; date: string; payload: Record<string, unknown> }

const geometry = JSON.parse(
  readFileSync(new URL('../db/seed/naryn-trolleybus-osm.json', import.meta.url), 'utf8'),
) as { original: LineString; extension: LineString; depotAccess: LineString; leninaLoop: LineString; raymilitsiyaLoop: LineString; depotArea: Polygon }
const pool = new pg.Pool({ connectionString: databaseUrl })
const actor = 'seed:naryn-trolleybus-history-v1'
const city = 'naryn'
const system = 'naryn'
const events: Event[] = []
const add = (type: string, date: string, payload: Record<string, unknown>) => events.push({ type, date, payload })
const chronicle = (date: string, title: string, summary: string) => add('chronicle.upsert', date, {
  id: `naryn-trolleybus-${date}`, city, mode: 'trolleybus', date, title, summary, network: '',
})

const stops: Array<{ id: string; name: string; point: [number, number]; since: string }> = [
  { id: 'raymilitsiya', name: 'Раймилиция', point: [75.9399274, 41.4280471], since: '2008-08-25' },
  { id: 'nalogovaya', name: 'Налоговая', point: [75.9411854, 41.427659], since: '2008-08-25' },
  { id: 'eldiyar', name: 'Магазин «Эльдияр»', point: [75.9463888, 41.4271944], since: '2008-08-25' },
  { id: 'naryn-suu', name: 'Нарын Суу', point: [75.9511819, 41.4266916], since: '2008-08-25' },
  { id: 'azs', name: 'АЗС', point: [75.9591267, 41.4259938], since: '2008-08-25' },
  { id: 'tilenbaeva', name: 'Улица Дуйшенбая Тиленбаева', point: [75.9623855, 41.4258188], since: '2008-08-25' },
  { id: 'mukasha-isakova', name: 'Улица Мукаша Исакова', point: [75.9656632, 41.4258188], since: '1994-10-30' },
  { id: 'mechet', name: 'Мечеть', point: [75.9693539, 41.4259917], since: '1994-10-30' },
  { id: 'zhalyn', name: 'АО «Жалын»', point: [75.9761453, 41.426583], since: '1994-10-30' },
  { id: 'mds', name: 'МДС', point: [75.9794605, 41.4266474], since: '1994-10-30' },
  { id: 'bazar', name: 'Базар', point: [75.9823063, 41.4267459], since: '1994-10-30' },
  { id: 'universitet', name: 'Университет', point: [75.9893793, 41.4276328], since: '1994-10-30' },
  { id: 'drama-theatre', name: 'Драматический театр', point: [75.9933946, 41.4280853], since: '1994-10-30' },
  { id: 'celebration-hall', name: 'Дом торжеств', point: [75.9999016, 41.4281296], since: '1994-10-30' },
  { id: 'school-2', name: 'Школа № 2', point: [76.0068619, 41.4272829], since: '1994-10-30' },
  { id: 'bus-station', name: 'Автовокзал', point: [76.0119313, 41.4252617], since: '1994-10-30' },
  { id: 'lenina', name: 'Улица Ленина', point: [76.0178241, 41.4235411], since: '1994-10-30' },
]

add('infra.upsert', '1994-10-30', {
  id: 'naryn-trolleybus-wire-original', kind: 'track', way: 'road', mode: 'trolleybus',
  since: '1994-10-30', until: '2025-06-19', name: 'Улица Ленина — поворот к депо · реконструкция',
  color: '#277a64', trackForm: 'double', geometry: geometry.original, reconstruction: true,
})
add('infra.upsert', '1994-10-30', {
  id: 'naryn-trolleybus-loop-lenina', kind: 'track', way: 'road', mode: 'trolleybus',
  since: '1994-10-30', until: '2025-06-19', name: 'Разворотное кольцо «Улица Ленина» · реконструкция',
  color: '#277a64', trackForm: 'single_oneway', geometry: geometry.leninaLoop, reconstruction: true,
})
add('infra.upsert', '1994-12-13', {
  id: 'naryn-trolleybus-wire-depot-access', kind: 'track', way: 'road', mode: 'trolleybus',
  since: '1994-12-13', until: '2025-06-19', name: 'Служебная линия в депо · реконструкция',
  color: '#277a64', trackForm: 'double', geometry: geometry.depotAccess, reconstruction: true,
})
add('infra.upsert', '1994-12-13', {
  id: 'naryn-trolleybus-depot', kind: 'area', facilityKind: 'depot', way: 'road', mode: 'trolleybus',
  since: '1994-12-13', until: '2025-03-04', name: 'Нарынское троллейбусное депо',
  color: '#277a64', trackForm: 'single_both', geometry: geometry.depotArea,
})
add('infra.upsert', '2008-08-25', {
  id: 'naryn-trolleybus-wire-extension', kind: 'track', way: 'road', mode: 'trolleybus',
  since: '2008-08-25', until: '2025-06-19', name: 'Поворот к депо — Раймилиция · реконструкция',
  color: '#277a64', trackForm: 'double', geometry: geometry.extension, reconstruction: true,
})
add('infra.upsert', '2008-08-25', {
  id: 'naryn-trolleybus-loop-raymilitsiya', kind: 'track', way: 'road', mode: 'trolleybus',
  since: '2008-08-25', until: '2025-06-19', name: 'Разворотное кольцо «Раймилиция» · реконструкция',
  color: '#277a64', trackForm: 'single_oneway', geometry: geometry.raymilitsiyaLoop, reconstruction: true,
})
for (const stop of stops) add('infra.upsert', stop.since, {
  id: `naryn-trolleybus-stop-${stop.id}`, kind: 'stop', way: 'road', mode: 'trolleybus',
  since: stop.since, until: '2024-05-31', name: stop.name,
  color: '#277a64', trackForm: 'single_both', geometry: { type: 'Point', coordinates: stop.point },
})
add('route.upsert', '1994-10-30', {
  id: 'naryn-trolleybus-1-opening', mode: 'trolleybus', number: '1',
  name: 'Поворот к депо — улица Ленина', color: '#277a64',
  segmentIds: ['naryn-trolleybus-wire-original', 'naryn-trolleybus-loop-lenina'],
  since: '1994-10-30', until: '1994-12-12',
})
add('route.upsert', '1994-12-13', {
  id: 'naryn-trolleybus-1-original', mode: 'trolleybus', number: '1',
  name: 'Депо — улица Ленина', color: '#277a64',
  segmentIds: ['naryn-trolleybus-wire-original', 'naryn-trolleybus-loop-lenina', 'naryn-trolleybus-wire-depot-access'],
  since: '1994-12-13', until: '2008-04-30',
})
add('route.upsert', '2008-08-25', {
  id: 'naryn-trolleybus-1-extended', mode: 'trolleybus', number: '1',
  name: 'Улица Ленина — Раймилиция', color: '#277a64',
  segmentIds: ['naryn-trolleybus-loop-lenina', 'naryn-trolleybus-wire-original', 'naryn-trolleybus-wire-extension', 'naryn-trolleybus-loop-raymilitsiya'],
  since: '2008-08-25', until: '2024-05-31',
})

chronicle('1994-10-30', 'Открытие Нарынского троллейбуса', 'Открылась первая линия от поворота к будущему депо до кольца «Улица Ленина». Дата и трасса приняты по подробной полевой истории предприятия; другие публикации называют 30 ноября или 30 декабря 1994 года.')
chronicle('1994-12-13', 'Открытие троллейбусного депо', 'Открылись территория депо и служебная контактная линия. До продления 2008 года троллейбусы использовали депо для разворота; отдельных стрелок на линейной части не было.')
chronicle('2008-05-01', 'Временная остановка движения', 'Весной движение приостановили. Во время перерыва контактную сеть продлили от улицы Мукаша Исакова к остановке «Раймилиция».')
chronicle('2008-08-25', 'Продление к Раймилиции', 'Между 25 и 30 августа движение возобновилось по новому участку от деповского узла до кольца «Раймилиция». В узле установили три стрелки и пересечение; точная дата открытия не сохранилась, поэтому используется нижняя граница известного интервала.')
chronicle('2024-05-31', 'Последний день движения', 'Троллейбусное движение остановилось из-за реконструкции улицы Ленина и неисправности тяговой подстанции.')
chronicle('2025-03-04', 'Решение о закрытии системы', 'Городские власти решили не восстанавливать троллейбус и демонтировать контактную сеть, заменив его автобусами.')
chronicle('2025-06-19', 'Почти полный демонтаж сети', 'К этой дате город сообщил о демонтаже 95 процентов контактных проводов и опор. Историческая инфраструктура на карте сохраняется до этой контрольной даты отдельно от маршрута, прекратившего работу годом ранее.')

const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query(
    `INSERT INTO cities (id, name, aliases, lat, lng, zoom, min_zoom, max_zoom)
     VALUES ($1, $2, $3, $4, $5, 13, 2, 22)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, aliases = EXCLUDED.aliases,
       lat = EXCLUDED.lat, lng = EXCLUDED.lng, zoom = EXCLUDED.zoom, min_zoom = EXCLUDED.min_zoom,
       max_zoom = EXCLUDED.max_zoom`,
    [city, 'Naryn', ['Нарын'], 41.4277, 75.9914],
  )
  await client.query(
    `INSERT INTO transport_systems (id, name, aliases, lat, lng, zoom, valid_from, valid_to)
     VALUES ($1, $2, $3, $4, $5, 13, $6, $7)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, aliases = EXCLUDED.aliases,
       lat = EXCLUDED.lat, lng = EXCLUDED.lng, zoom = EXCLUDED.zoom,
       valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to`,
    [system, 'Naryn', ['Нарын'], 41.4277, 75.9914, '1994-10-30', '2024-05-31'],
  )
  await client.query('DELETE FROM transport_system_names WHERE system_id = $1', [system])
  await client.query(
    `INSERT INTO transport_system_names (system_id, name, valid_from, valid_to)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (system_id, valid_from) DO UPDATE SET name = EXCLUDED.name, valid_to = EXCLUDED.valid_to`,
    [system, 'Naryn', '1994-10-30', '2024-05-31'],
  )
  await client.query('DELETE FROM transport_system_localities WHERE system_id = $1', [system])
  await client.query(
    `INSERT INTO transport_system_localities (system_id, locality_id, name, role, valid_from, valid_to)
     VALUES ($1, $2, $3, 'core', $4, $5)
     ON CONFLICT (system_id, locality_id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
       valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to`,
    [system, city, 'Naryn', '1994-10-30', '2024-05-31'],
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
  console.log(`seeded ${events.length} Naryn trolleybus history events`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
