import { readFileSync } from 'node:fs'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

type LineString = { type: 'LineString'; coordinates: [number, number][] }
type Event = { type: string; date: string; payload: Record<string, unknown> }

const geometry = JSON.parse(
  readFileSync(new URL('../db/seed/naryn-trolleybus-osm.json', import.meta.url), 'utf8'),
) as { original: LineString; extension: LineString }
const pool = new pg.Pool({ connectionString: databaseUrl })
const actor = 'seed:naryn-trolleybus-history-v1'
const city = 'naryn'
const system = 'naryn'
const events: Event[] = []
const add = (type: string, date: string, payload: Record<string, unknown>) => events.push({ type, date, payload })
const chronicle = (date: string, title: string, summary: string) => add('chronicle.upsert', date, {
  id: `naryn-trolleybus-${date}`, city, mode: 'trolleybus', date, title, summary, network: '',
})

add('infra.upsert', '1994-12-30', {
  id: 'naryn-trolleybus-wire-original', kind: 'track', way: 'road', mode: 'trolleybus',
  since: '1994-12-30', until: '2024-05-31', name: 'Автовокзал — улица Мукаша Исакова · реконструкция',
  color: '#277a64', trackForm: 'double', geometry: geometry.original, reconstruction: true,
})
add('infra.upsert', '2008-08-25', {
  id: 'naryn-trolleybus-wire-extension', kind: 'track', way: 'road', mode: 'trolleybus',
  since: '2008-08-25', until: '2024-05-31', name: 'Улица Мукаша Исакова — Раймилиция · реконструкция',
  color: '#277a64', trackForm: 'double', geometry: geometry.extension, reconstruction: true,
})
add('route.upsert', '1994-12-30', {
  id: 'naryn-trolleybus-1-original', mode: 'trolleybus', number: '1',
  name: 'Автовокзал — улица Мукаша Исакова', color: '#277a64',
  segmentIds: ['naryn-trolleybus-wire-original'], since: '1994-12-30', until: '2008-04-30',
})
add('route.upsert', '2008-08-25', {
  id: 'naryn-trolleybus-1-extended', mode: 'trolleybus', number: '1',
  name: 'Улица Ленина — Раймилиция', color: '#277a64',
  segmentIds: ['naryn-trolleybus-wire-original', 'naryn-trolleybus-wire-extension'],
  since: '2008-08-25', until: '2024-05-31',
})

chronicle('1994-12-30', 'Открытие Нарынского троллейбуса', 'Открыта единственная линия по улице Ленина от автовокзала до улицы Мукаша Исакова. Источники расходятся в дне открытия; для набора принята дата 30 декабря, указанная местными материалами. Трасса реконструирована по современному коридору улицы.')
chronicle('2008-05-01', 'Временная остановка движения', 'Весной движение приостановили. Во время перерыва контактную сеть продлили от улицы Мукаша Исакова к остановке «Раймилиция».')
chronicle('2008-08-25', 'Продление к Раймилиции', 'В конце августа — начале сентября движение возобновилось по продлённой линии. Точная дата открытия участка в источниках не сохранилась; 25 августа используется как нижняя граница известного интервала.')
chronicle('2024-05-31', 'Последний день движения', 'Троллейбусное движение остановилось из-за реконструкции улицы Ленина и неисправности тяговой подстанции.')
chronicle('2025-03-04', 'Решение о закрытии системы', 'Городские власти решили не восстанавливать троллейбус и демонтировать контактную сеть, заменив его автобусами.')

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
    [system, 'Naryn', ['Нарын'], 41.4277, 75.9914, '1994-12-30', '2024-05-31'],
  )
  await client.query(
    `INSERT INTO transport_system_names (system_id, name, valid_from, valid_to)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (system_id, valid_from) DO UPDATE SET name = EXCLUDED.name, valid_to = EXCLUDED.valid_to`,
    [system, 'Naryn', '1994-12-30', '2024-05-31'],
  )
  await client.query(
    `INSERT INTO transport_system_localities (system_id, locality_id, name, role, valid_from, valid_to)
     VALUES ($1, $2, $3, 'core', $4, $5)
     ON CONFLICT (system_id, locality_id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
       valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to`,
    [system, city, 'Naryn', '1994-12-30', '2024-05-31'],
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
