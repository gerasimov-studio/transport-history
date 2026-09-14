import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const pool = new pg.Pool({ connectionString: databaseUrl })
type Point = [number, number]
type Event = { scope: string; date: string; type: string; payload: Record<string, unknown> }
const actor = 'seed:regional-system-scenarios-v1'
const events: Event[] = []
const add = (scope: string, date: string, type: string, payload: Record<string, unknown>) => events.push({ scope, date, type, payload })
const track = (scope: string, id: string, mode: 'tram' | 'trolleybus', name: string, since: string, until: string | undefined, points: Point[], grade: 'surface' | 'tunnel' = 'surface') => add(scope, since, 'infra.upsert', {
  id, kind: 'track', way: mode === 'tram' ? 'rail' : 'road', mode, gauge: mode === 'tram' ? 1524 : undefined,
  grade, level: grade === 'tunnel' ? -1 : undefined, since, until, name, color: '#8b9098',
  trackForm: 'double', geometry: { type: 'LineString', coordinates: points },
})
const route = (scope: string, id: string, mode: 'tram' | 'trolleybus', number: string, name: string, color: string, since: string, until: string | undefined, ids: string[]) => add(scope, since, 'route.upsert', {
  id, mode, number, name, color, since, until, segmentIds: ids,
})
const chronicle = (scope: string, date: string, mode: 'tram' | 'trolleybus', title: string, summary: string) => add(scope, date, 'chronicle.upsert', {
  id: `${scope}-${date}`, city: scope, mode, date, title, summary, network: '',
})

const vg = 'system:volgograd-volzhsky'
track(vg, 'vg-tram-north', 'tram', 'Северная сеть Волгограда', '1936-01-01', undefined, [[44.568,48.825],[44.585,48.78],[44.602,48.742],[44.61,48.715]])
track(vg, 'vg-tram-south', 'tram', 'Изолированная южная сеть', '1958-01-01', undefined, [[44.44,48.61],[44.46,48.63],[44.48,48.65]])
track(vg, 'vg-metrotram-tunnel', 'tram', 'Подземный участок скоростного трамвая', '1984-11-05', undefined, [[44.51,48.716],[44.516,48.708],[44.523,48.697]], 'tunnel')
track(vg, 'volzhsky-tram', 'tram', 'Волжская трамвайная сеть', '1963-12-30', undefined, [[44.72,48.79],[44.75,48.78],[44.78,48.77],[44.81,48.75]])
route(vg, 'vg-route-st', 'tram', 'СТ', 'ВГТЗ — Ельшанка', '#d71920', '1984-11-05', undefined, ['vg-tram-north','vg-metrotram-tunnel'])
route(vg, 'volzhsky-route-1', 'tram', '1', 'Логинова — Волжский трубный завод', '#2f78b7', '1963-12-30', undefined, ['volzhsky-tram'])
chronicle(vg, '1963-12-30', 'tram', 'Система стала полицентрической', 'К волгоградским сетям добавилась отдельная сеть Волжского. Она входит в общий исторический контекст региона, но топологически не соединена с Волгоградом.')
chronicle(vg, '1984-11-05', 'tram', 'Открытие скоростного трамвая', 'Наземная трамвайная инфраструктура получила подземный центральный участок. Для движка это одна линия с участками разных типов и уровней.')

const se = 'system:saratov-engels'
track(se, 'saratov-wire', 'trolleybus', 'Саратовская контактная сеть', '1952-11-06', undefined, [[46.0,51.55],[46.02,51.54],[46.04,51.53],[46.06,51.52]])
track(se, 'engels-wire', 'trolleybus', 'Энгельсская контактная сеть', '1964-01-01', undefined, [[46.10,51.50],[46.12,51.49],[46.14,51.48]])
track(se, 'bridge-wire-1966', 'trolleybus', 'Контактная сеть на старом мосту', '1966-01-22', '2004-03-23', [[46.06,51.52],[46.08,51.51],[46.10,51.50]])
track(se, 'bridge-wire-2021', 'trolleybus', 'Восстановленная контактная сеть на мосту', '2021-07-02', undefined, [[46.06,51.52],[46.08,51.51],[46.10,51.50]])
route(se, 'saratov-engels-9', 'trolleybus', '9', 'Саратов — Энгельс', '#2e7d4f', '1966-01-22', '2004-03-23', ['saratov-wire','bridge-wire-1966','engels-wire'])
route(se, 'saratov-engels-109', 'trolleybus', '109', 'Саратов — Энгельс', '#2e7d4f', '2021-07-02', undefined, ['saratov-wire','bridge-wire-2021','engels-wire'])
chronicle(se, '1966-01-22', 'trolleybus', 'Междугородный маршрут №9', 'Контактная сеть через Волгу объединила две городские подсети в один сквозной маршрут.')
chronicle(se, '2004-03-23', 'trolleybus', 'Разрыв системы', 'Движение через мост прекратилось: городские подсети сохранились, а соединительный участок и сквозной маршрут перестали действовать.')
chronicle(se, '2021-07-02', 'trolleybus', 'Восстановление связи', 'После 17-летнего перерыва новый маршрут №109 снова связал Саратов и Энгельс. В модели это новая версия инфраструктуры в прежнем коридоре.')

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const system of [
    { id: vg, name: 'Волгоград — Волжский', aliases: ['Volgograd — Volzhsky'], lat: 48.72, lng: 44.65, zoom: 10, from: '1936-01-01' },
    { id: se, name: 'Саратов — Энгельс', aliases: ['Saratov — Engels'], lat: 51.52, lng: 46.07, zoom: 11, from: '1952-11-06' },
  ]) await client.query(`INSERT INTO transport_systems (id,name,aliases,lat,lng,zoom,valid_from)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, aliases=EXCLUDED.aliases,
    lat=EXCLUDED.lat,lng=EXCLUDED.lng,zoom=EXCLUDED.zoom,valid_from=EXCLUDED.valid_from`,
  [system.id,system.name,system.aliases,system.lat,system.lng,system.zoom,system.from])
  const localities = [[vg,'volgograd','Волгоград','core'],[vg,'volzhsky','Волжский','served'],[se,'saratov','Саратов','core'],[se,'engels','Энгельс','connected']]
  for (const row of localities) await client.query(`INSERT INTO transport_system_localities (system_id,locality_id,name,role)
    VALUES ($1,$2,$3,$4) ON CONFLICT (system_id,locality_id) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role`, row)
  await client.query('DELETE FROM events WHERE actor=$1', [actor])
  for (const event of events) await client.query(`INSERT INTO events (type,occurred_on,city_id,scope_id,actor,payload)
    VALUES ($1,$2,NULL,$3,$4,$5::jsonb)`, [event.type,event.date,event.scope,actor,JSON.stringify(event.payload)])
  await client.query('COMMIT')
  console.log(`seeded ${events.length} regional-system events`)
} catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release(); await pool.end() }
