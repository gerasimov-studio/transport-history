import { readFileSync } from 'node:fs'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

type Point = [number, number]
type Segment = { id: string; since: string; coords: Point[]; reconstruction?: boolean }
type Event = { type: string; date: string; payload: Record<string, unknown> }
type Station = { id: string; name: string; since: string; point: Point }

const source = JSON.parse(readFileSync(new URL('../db/seed/baku-metro-segments.json', import.meta.url), 'utf8')) as { segments: Segment[] }
const actor = 'seed:baku-metro-history-v1'
const city = 'baku'
const events: Event[] = []
const add = (type: string, date: string, payload: Record<string, unknown>) => events.push({ type, date, payload })
const infraId = (id: string) => `baku-metro-track-${id}`
const chronicle = (date: string, title: string, summary: string) => add('chronicle.upsert', date, {
  id: `baku-metro-${date}`, city, mode: 'metro', date, title, summary, network: '',
})

const initial = source.segments.find((segment) => segment.id === 'red-initial')!
const split = 7
const segments: Segment[] = [
  { ...initial, id: 'red-west', coords: initial.coords.slice(0, split + 1) },
  { ...initial, id: 'shared-1967', coords: initial.coords.slice(split) },
  ...source.segments.filter((segment) => segment.id !== 'red-initial'),
]

for (const segment of segments) {
  add('infra.upsert', segment.since, {
    id: infraId(segment.id), kind: 'track', way: 'rail', mode: 'metro', gauge: 1520,
    grade: segment.id === 'bakmil' ? 'surface' : 'tunnel', level: segment.id === 'bakmil' ? undefined : -1,
    since: segment.since, name: segment.reconstruction ? 'Xətai branch · reconstruction' : `Bakı metro · ${segment.id}`,
    color: '#8b9098', trackForm: 'double', reconstruction: Boolean(segment.reconstruction),
    geometry: { type: 'LineString', coordinates: segment.coords },
  })
}

const stations: Station[] = [
  { id: 'icherisheher', name: 'İçərişəhər', since: '1967-11-06', point: [49.8316472, 40.3659588] },
  { id: 'sahil', name: 'Sahil', since: '1967-11-06', point: [49.8445724, 40.3717258] },
  { id: '28-may', name: '28 May', since: '1967-11-06', point: [49.8486359, 40.3798619] },
  { id: 'ganjlik', name: 'Gənclik', since: '1967-11-06', point: [49.8508967, 40.4005006] },
  { id: 'narimanov', name: 'Nəriman Nərimanov', since: '1967-11-06', point: [49.8706376, 40.4028217] },
  { id: 'xatai', name: 'Xətai', since: '1968-02-22', point: [49.8721454, 40.3832514] },
  { id: 'ulduz', name: 'Ulduz', since: '1970-04-17', point: [49.8914348, 40.414963] },
  { id: 'koroglu', name: 'Koroğlu', since: '1972-11-06', point: [49.9180263, 40.4208508] },
  { id: 'qara-qarayev', name: 'Qara Qarayev', since: '1972-11-06', point: [49.9339594, 40.4176118] },
  { id: 'neftchilar', name: 'Neftçilər', since: '1972-11-06', point: [49.9425681, 40.411155] },
  { id: 'nizami', name: 'Nizami', since: '1976-12-31', point: [49.8300187, 40.3793192] },
  { id: 'bakmil', name: 'Bakmil', since: '1979-03-28', point: [49.879234, 40.4128725] },
  { id: 'elmler', name: 'Elmlər Akademiyası', since: '1985-12-31', point: [49.8154836, 40.3751519] },
  { id: 'inshaatchilar', name: 'İnşaatçılar', since: '1985-12-31', point: [49.8023575, 40.3890935] },
  { id: '20-yanvar', name: '20 Yanvar', since: '1985-12-31', point: [49.8056, 40.4033] },
  { id: 'memar-ajami-green', name: 'Memar Əcəmi', since: '1985-12-31', point: [49.8124456, 40.4104823] },
  { id: 'xalqlar', name: 'Xalqlar Dostluğu', since: '1989-04-28', point: [49.9529864, 40.3968851] },
  { id: 'ahmadli', name: 'Əhmədli', since: '1989-04-28', point: [49.9539452, 40.3855583] },
  { id: 'jafar-jabbarli', name: 'Cəfər Cabbarlı', since: '1993-10-27', point: [49.8489498, 40.379652] },
  { id: 'hazi-aslanov', name: 'Həzi Aslanov', since: '2002-12-10', point: [49.9535736, 40.3730376] },
  { id: 'nasimi', name: 'Nəsimi', since: '2008-10-09', point: [49.82147, 40.42377] },
  { id: 'azadliq', name: 'Azadlıq prospekti', since: '2009-12-30', point: [49.8429264, 40.4259622] },
  { id: 'darnagul', name: 'Dərnəgül', since: '2011-06-29', point: [49.8617881, 40.4254022] },
  { id: 'avtovagzal', name: 'Avtovağzal', since: '2016-04-19', point: [49.7934384, 40.4241403] },
  { id: 'memar-ajami-purple', name: 'Memar Əcəmi', since: '2016-04-19', point: [49.8124557, 40.410448] },
  { id: '8-noyabr', name: '8 Noyabr', since: '2021-05-29', point: [49.820828, 40.4018871] },
  { id: 'xocasan', name: 'Xocəsən', since: '2022-12-23', point: [49.7790664, 40.4211517] },
]

for (const station of stations) add('infra.upsert', station.since, {
  id: `baku-metro-station-${station.id}`, kind: 'stop', way: 'rail', mode: 'metro', gauge: 1520,
  grade: station.id === 'bakmil' ? 'surface' : 'tunnel', level: station.id === 'bakmil' ? undefined : -1,
  since: station.since, name: station.name, color: '#d7c4a3', trackForm: 'double',
  geometry: { type: 'Point', coordinates: station.point },
})

const red = ['red-west', 'shared-1967', 'red-ulduz', 'red-1972', 'red-1989a', 'red-1989b', 'red-2002']
const sharedEast = ['shared-1967', 'red-ulduz', 'red-1972', 'red-1989a', 'red-1989b', 'red-2002']
const green = ['green-nizami', 'green-1985', 'green-nasimi', 'green-azadlig', 'green-darnagul']
const route = (id: string, number: string, name: string, color: string, since: string, ids: string[]) => add('route.upsert', since, {
  id, mode: 'metro', number, name, color, since, segmentIds: ids.map(infraId),
})
route('baku-metro-red', '1', 'Qırmızı xətt · İçərişəhər — Həzi Aslanov', '#d71920', '1967-11-06', red)
route('baku-metro-khatai', '2X', 'Cəfər Cabbarlı — Xətai', '#159447', '1968-02-22', ['khatai-shuttle'])
route('baku-metro-bakmil', '1B', 'İçərişəhər — Bakmil', '#d71920', '1979-03-28', ['red-west', 'shared-1967', 'bakmil'])
route('baku-metro-green', '2', 'Yaşıl xətt · Dərnəgül — Həzi Aslanov', '#159447', '1976-12-31', [...green, ...sharedEast])
route('baku-metro-purple', '3', 'Bənövşəyi xətt · Xocəsən — 8 Noyabr', '#8d4b9b', '2016-04-19', ['purple-xocasan', 'purple-2016', 'purple-2021'])

chronicle('1967-11-06', 'Bakıda metro açıldı', 'İlk 6,5 kilometrlik sahədə İçərişəhər, Sahil, 28 May, Gənclik və Nəriman Nərimanov stansiyaları sərnişinlərə açıldı.')
chronicle('1968-02-22', 'Xətai qolu', '28 May yaxınlığındakı ayrılmadan Xətai stansiyasına hərəkət başlandı. Bu qol sonradan Cəfər Cabbarlı — Xətai məkik marşrutuna çevrildi.')
chronicle('1970-04-17', 'Ulduz stansiyası', 'Qırmızı xətt Nərimanovdan sənaye rayonuna — Ulduz stansiyasına uzadıldı.')
chronicle('1972-11-06', 'Şərqə ilk böyük uzadılma', 'Koroğlu, Qara Qarayev və Neftçilər stansiyaları açıldı.')
chronicle('1976-12-31', 'Yaşıl xəttin başlanğıcı', '28 Maydan Nizami stansiyasına yeni qol açıldı.')
chronicle('1979-03-28', 'Bakmil stansiyası', 'Depo dayanacağı yenidən qurularaq Elektrozavod adı ilə yerüstü stansiya kimi açıldı; sonradan Bakmil adlandırıldı.')
chronicle('1985-12-31', 'Yaşıl xətt Memar Əcəmiyə çatdı', 'Elmlər Akademiyası, İnşaatçılar, 20 Yanvar və Memar Əcəmi stansiyalarından ibarət 6,5 kilometrlik sahə istifadəyə verildi.')
chronicle('1989-04-28', 'Əhmədliyə uzadılma', 'Xalqlar Dostluğu və Əhmədli stansiyaları açıldı.')
chronicle('1993-10-27', 'Cəfər Cabbarlı stansiyası', 'Cəfər Cabbarlı stansiyasının ilk platforması açıldı və 28 May stansiyasına keçid istifadəyə verildi.')
chronicle('2002-12-10', 'Həzi Aslanov', 'Qırmızı xəttin şərq sonluğu Həzi Aslanov stansiyasına çatdı.')
chronicle('2008-10-09', 'Şimal sahəsinin inkişafı', 'Yaşıl xəttdə Nəsimi stansiyası açıldı.')
chronicle('2009-12-30', 'Azadlıq prospekti', 'Yaşıl xətt Azadlıq prospekti stansiyasına uzadıldı.')
chronicle('2011-06-29', 'Dərnəgül', 'Yaşıl xəttin yeni şimal sonluğu Dərnəgül stansiyası oldu.')
chronicle('2016-04-19', 'Bənövşəyi xətt', 'Avtovağzal və Memar Əcəmi stansiyaları ilə müstəqil Bənövşəyi xətt açıldı.')
chronicle('2021-05-29', '8 Noyabr', 'Bənövşəyi xətt 8 Noyabr stansiyasına qədər uzadıldı.')
chronicle('2022-12-23', 'Xocəsən və yeni depo', 'Xocəsən stansiyası və elektrik deposu açıldı; şəbəkə 27 stansiyaya çatdı.')

const pool = new pg.Pool({ connectionString: databaseUrl })
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query(`INSERT INTO cities (id, name, aliases, lat, lng, zoom, min_zoom, max_zoom)
    VALUES ($1,$2,$3,$4,$5,12,2,22) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, aliases=EXCLUDED.aliases,
    lat=EXCLUDED.lat, lng=EXCLUDED.lng, zoom=EXCLUDED.zoom, min_zoom=EXCLUDED.min_zoom, max_zoom=EXCLUDED.max_zoom`,
  [city, 'Baku', ['Bakı', 'Баку'], 40.3953, 49.8666])
  await client.query(`INSERT INTO transport_systems (id, name, aliases, lat, lng, zoom, valid_from)
    VALUES ($1,$2,$3,$4,$5,12,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, aliases=EXCLUDED.aliases,
    lat=EXCLUDED.lat, lng=EXCLUDED.lng, zoom=EXCLUDED.zoom, valid_from=EXCLUDED.valid_from`,
  [city, 'Bakı Metro', ['Baku Metro', 'Бакинский метрополитен'], 40.3953, 49.8666, '1967-11-06'])
  await client.query(`INSERT INTO transport_system_localities (system_id, locality_id, name, role, valid_from)
    VALUES ($1,$1,$2,'core',$3) ON CONFLICT (system_id, locality_id) DO UPDATE SET
    name=EXCLUDED.name, role=EXCLUDED.role, valid_from=EXCLUDED.valid_from`,
  [city, 'Bakı', '1967-11-06'])
  await client.query('DELETE FROM events WHERE actor = $1', [actor])
  for (const event of events) await client.query(
    `INSERT INTO events (type, occurred_on, city_id, scope_id, actor, payload) VALUES ($1,$2,$3,$3,$4,$5::jsonb)`,
    [event.type, event.date, city, actor, JSON.stringify(event.payload)],
  )
  await client.query('COMMIT')
  console.log(`seeded ${events.length} Baku metro history events`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
