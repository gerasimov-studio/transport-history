import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const pool = new pg.Pool({ connectionString: databaseUrl })
const actor = 'seed:sarajevo-tram-history-v1'
const city = 'sarajevo'

type Event = { type: string; date: string; payload: Record<string, unknown> }
type Point = [number, number]

const oldStation: Point = [18.3992, 43.8554]
const earlyHorse: Point[] = [
  [18.4254, 43.8597], [18.4210, 43.8590], [18.4140, 43.8585], [18.4074, 43.8560], oldStation,
]
const earlyElectric: Point[] = [
  [18.4286, 43.8578], [18.4236, 43.8567], [18.4202, 43.8566], [18.4135, 43.8563],
  [18.4074, 43.8557], oldStation,
]
const standardGauge: Point[] = [
  [18.3091, 43.8308], [18.3116, 43.8336], [18.3170, 43.8373], [18.3216, 43.8406],
  [18.3276, 43.8427], [18.3399, 43.8451], [18.3468, 43.8462], [18.3534, 43.8472],
  [18.3597, 43.8481], [18.3661, 43.8491], [18.3719, 43.8501], [18.3782, 43.8514],
  [18.3844, 43.8525], [18.3917, 43.8539], [18.3977, 43.8555], [18.4007, 43.8556],
  [18.4074, 43.8557], [18.4123, 43.8577], [18.4197, 43.8589], [18.4254, 43.8597],
  [18.4313, 43.8600], [18.4335, 43.8588], [18.4286, 43.8578], [18.4236, 43.8567],
  [18.4202, 43.8566], [18.4135, 43.8563], [18.4074, 43.8557],
]

const events: Event[] = []
const add = (type: string, date: string, payload: Record<string, unknown>) => events.push({ type, date, payload })
const track = (id: string, name: string, gauge: number, since: string, until: string | undefined, coordinates: Point[]) => ({
  id, kind: 'track', way: 'rail', gauge, grade: 'surface', since, until, name,
  color: gauge === 760 ? '#a66a3f' : '#8b9098', trackForm: 'single_both',
  geometry: { type: 'LineString', coordinates },
})
const route = (id: string, number: string, name: string, since: string, until: string | undefined, segmentIds: string[]) => ({
  id, mode: 'tram', number, name, color: '#d32027', segmentIds, since, until,
})
const chronicle = (date: string, title: string, summary: string) => add('chronicle.upsert', date, {
  id: `sarajevo-tram-${date}`, city, mode: 'tram', date, title, summary, network: '',
})

add('infra.upsert', '1885-01-01', track('sarajevo-tram-1885', 'Ferhadija — Stara željeznička stanica', 760, '1885-01-01', '1895-04-30', earlyHorse))
add('route.upsert', '1885-01-01', route('sarajevo-tram-horse', 'K', 'Konjski tramvaj', '1885-01-01', '1895-04-30', ['sarajevo-tram-1885']))
chronicle('1885-01-01', 'Prvi sarajevski tramvaj', 'Otvorena je približno 3,1 km duga jednokolosiječna linija konjskog tramvaja između Ferhadije i stare željezničke stanice. Rekonstrukcija trase je približna; kolosijek je bio širine 760 mm.')

add('infra.upsert', '1895-05-01', track('sarajevo-tram-1895', 'Latinska ćuprija — Stara željeznička stanica', 760, '1895-05-01', '1960-10-09', earlyElectric))
add('route.upsert', '1895-05-01', route('sarajevo-tram-electric-760', 'E', 'Prvi električni tramvaj', '1895-05-01', '1960-10-09', ['sarajevo-tram-1895']))
chronicle('1895-05-01', 'Elektrifikacija tramvaja', 'Prvi električni tramvaj prošao je trasom od stare željezničke stanice preko Hiseta i Obale Kulina bana do Latinske ćuprije. Sačuvana je bosanska kolosiječna širina 760 mm.')

add('infra.upsert', '1960-10-10', track('sarajevo-tram-standard', 'Ilidža — Baščaršija', 1435, '1960-10-10', undefined, standardGauge))
add('route.upsert', '1960-10-10', route('sarajevo-tram-standard-prewar', '3', 'Ilidža — Baščaršija', '1960-10-10', '1992-04-14', ['sarajevo-tram-standard']))
chronicle('1960-10-10', 'Prelazak na standardni kolosijek', 'Uskotračni tramvaj završio je saobraćaj 9. oktobra 1960. Nova mreža koristi standardni kolosijek širine 1435 mm; prikazana os prati glavnu današnju trasu Ilidža — Baščaršija.')

chronicle('1992-04-15', 'Prekid saobraćaja tokom opsade', 'Tramvajski saobraćaj je obustavljen nakon početka opsade Sarajeva. Pruga i vozila pretrpjeli su velika oštećenja.')

add('route.upsert', '1994-04-15', route('sarajevo-tram-standard-restored', '3', 'Ilidža — Baščaršija', '1994-04-15', undefined, ['sarajevo-tram-standard']))
chronicle('1994-04-15', 'Obnova tramvajskog saobraćaja', 'Tramvaji su ponovo počeli voziti 15. aprila 1994, još tokom opsade Sarajeva.')

const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query(
    `INSERT INTO cities (id, name, aliases, lat, lng, zoom, min_zoom, max_zoom)
     VALUES ($1, $2, $3, $4, $5, 13, 2, 22)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, aliases = EXCLUDED.aliases,
       lat = EXCLUDED.lat, lng = EXCLUDED.lng, zoom = EXCLUDED.zoom, min_zoom = EXCLUDED.min_zoom,
       max_zoom = EXCLUDED.max_zoom`,
    [city, 'Sarajevo', ['Сараево', 'Сарајево'], 43.8563, 18.4131],
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
  console.log(`seeded ${events.length} Sarajevo tram history events`)
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
