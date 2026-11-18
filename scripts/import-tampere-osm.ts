const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3001'
const username = process.env.EDITOR_USERNAME ?? 'editor'
const password = process.env.EDITOR_PASSWORD ?? 'editor'
const routeIDs = [13072751, 13072752, 16321254, 16321255]
const masterIDs = [13072753, 12758107]

type Tags = Record<string, string>
type Node = { id: number; version: number; lat: number; lon: number; tags?: Tags }
type Way = { id: number; version: number; nodes: number[]; tags?: Tags }
type Member = { type: 'node' | 'way' | 'relation'; ref: number; role: string }
type Relation = { id: number; version: number; members: Member[]; tags?: Tags }
type Document = { nodes: Node[]; ways: Way[]; relations: Relation[] }

function decode(value: string) {
  return value.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
}
function attrs(raw: string) {
  return Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]))
}
function tags(body: string): Tags {
  return Object.fromEntries([...body.matchAll(/<tag\s+([^>]+)\/>/g)].map((m) => { const a = attrs(m[1]); return [a.k, a.v] }))
}
function parse(xml: string): Document {
  const nodes: Node[] = [], ways: Way[] = [], relations: Relation[] = []
  for (const m of xml.matchAll(/<node\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
    const a = attrs(m[1]); nodes.push({ id: Number(a.id), version: Number(a.version), lat: Number(a.lat), lon: Number(a.lon), tags: tags(m[2] ?? '') })
  }
  for (const m of xml.matchAll(/<way\s+([^>]+)>([\s\S]*?)<\/way>/g)) {
    const a = attrs(m[1]); ways.push({ id: Number(a.id), version: Number(a.version), nodes: [...m[2].matchAll(/<nd\s+ref="(-?\d+)"\/>/g)].map((n) => Number(n[1])), tags: tags(m[2]) })
  }
  for (const m of xml.matchAll(/<relation\s+([^>]+)>([\s\S]*?)<\/relation>/g)) {
    const a = attrs(m[1]); const members = [...m[2].matchAll(/<member\s+([^>]+)\/>/g)].map((entry) => { const q = attrs(entry[1]); return { type: q.type as Member['type'], ref: Number(q.ref), role: q.role ?? '' } })
    relations.push({ id: Number(a.id), version: Number(a.version), members, tags: tags(m[2]) })
  }
  return { nodes, ways, relations }
}
const unique = <T extends { id: number }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()]

async function osm(path: string) {
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/${path}`, { headers: { 'user-agent': 'transporthistory/1.0' } })
  if (!response.ok) throw new Error(`OSM ${path}: ${response.status}`)
  return parse(await response.text())
}
async function tampereInfrastructure() {
  const query = `[out:xml][timeout:90];(way[railway=tram](61.43,23.62,61.55,23.95);way[railway=light_rail](61.43,23.62,61.55,23.95);way[depot=tram](61.43,23.62,61.55,23.95););(._;>;);out meta;`
  let lastStatus = 0
  for (const endpoint of ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'transporthistory/1.0' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(120_000),
      })
      if (response.ok) return parse(await response.text())
      lastStatus = response.status
    } catch (error) {
      if (error instanceof Error && error.name !== 'TimeoutError') throw error
    }
  }
  throw new Error(`Overpass infrastructure: ${lastStatus}`)
}
async function request(path: string, init?: RequestInit & { cookie?: string }) {
  const headers = new Headers(init?.headers); headers.set('content-type', 'application/json'); if (init?.cookie) headers.set('cookie', init.cookie)
  const response = await fetch(baseURL + path, { ...init, headers }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response
}

const documents = await Promise.all(routeIDs.map((id) => osm(`relation/${id}/full`)))
const infrastructure = await tampereInfrastructure()
const nodes = unique([...documents.flatMap((document) => document.nodes), ...infrastructure.nodes])
const nodeByID = new Map(nodes.map((node) => [node.id, node]))
const ways = unique([...documents.flatMap((document) => document.ways), ...infrastructure.ways])

const routePhases = [
  { number: 1, start: '2021-08-09', end: '2023-08-06', routes: [[13072751, 1], [13072752, 1], [12758105, 3], [12758106, 3]] },
  { number: 2, start: '2023-08-07', end: '2025-01-06', routes: [[13072751, 3], [13072752, 3], [12758105, 6], [12758106, 7]] },
  // The opening-day relations were incomplete. These later OSM versions are
  // data corrections for the same 2025 service pattern: they include all
  // Pyhällönpuisto stops, platforms and the subsequently split way members.
  { number: 3, start: '2025-01-07', end: '', routes: [[13072751, 23], [13072752, 25], [16321254, 12], [16321255, 12]] },
] as const

async function historicalRoutes(phase: typeof routePhases[number]) {
  const source = await Promise.all(phase.routes.map(([id, version]) => osm(`relation/${id}/${version}`)))
  const children = source.flatMap((document, index) => document.relations.map((relation) => ({
    ...relation,
    id: -(phase.number * 100_000_000 + relation.id),
    version: 1,
    tags: { ...relation.tags, route: 'light_rail', direction: index % 2 === 0 ? 'forward' : 'backward', start_date: phase.start, end_date: phase.end },
  })))
  return [1, 3].map((line, lineIndex): Relation => ({
    id: -(900_000_000 + phase.number * 10 + line), version: 1,
    members: children.slice(lineIndex * 2, lineIndex * 2 + 2).map((relation) => ({ type: 'relation', ref: relation.id, role: '' })),
    tags: { type: 'route_master', route_master: 'light_rail', ref: String(line), name: `Tampere tram line ${line}`, colour: '#c43b32', start_date: phase.start, end_date: phase.end },
  })).concat(children)
}
const relationsByPhase = new Map<number, Relation[]>()
for (const phase of routePhases) relationsByPhase.set(phase.number, await historicalRoutes(phase))

// The western branch opened in two stages. Geometry is kept as OSM primitives;
// this classification only assigns each primitive to its real opening changeset.
function phaseForWay(way: Way) {
  const coordinates = way.nodes.map((id) => nodeByID.get(id)).filter((node): node is Node => Boolean(node))
  if (coordinates.length === 0) return 1
  const longitude = coordinates.reduce((sum, node) => sum + node.lon, 0) / coordinates.length
  if (longitude < 23.7155) return 3
  if (longitude < 23.7425) return 2
  return 1
}
const wayPhase = new Map(ways.map((way) => [way.id, phaseForWay(way)]))
for (const [phaseNumber, relations] of relationsByPhase) {
  for (const relation of relations) {
    if (relation.tags?.type !== 'route') continue
    for (const member of relation.members) {
      if (member.type === 'way') wayPhase.set(member.ref, Math.min(wayPhase.get(member.ref) ?? phaseNumber, phaseNumber))
    }
  }
}
const nodePhase = new Map<number, number>()
for (const way of ways) for (const id of way.nodes) nodePhase.set(id, Math.min(nodePhase.get(id) ?? 3, wayPhase.get(way.id) ?? 1))
for (const [phaseNumber, relations] of relationsByPhase) {
  for (const relation of relations) {
    if (relation.tags?.type !== 'route') continue
    for (const member of relation.members) {
      if (member.type === 'node' && member.role.startsWith('stop')) {
        nodePhase.set(member.ref, Math.min(nodePhase.get(member.ref) ?? phaseNumber, phaseNumber))
      }
    }
  }
}

const phases = [
  { number: 1, date: '2021-08-09', title: 'Tampere tramway opened', summary: 'Line 1 opened from Sorin aukio to Kaupin kampus (3.8 km), and line 3 opened from Hervantajärvi to Pyynikintori (11.5 km).' },
  { number: 2, date: '2023-08-07', title: 'Line 3 extended to Santalahti', summary: 'The 2 km Pyynikintori–Santalahti section opened for regular service.' },
  { number: 3, date: '2025-01-07', title: 'Line 1 extended to Pyhällönpuisto', summary: 'The 4.6 km Santalahti–Pyhällönpuisto section opened, extending line 1 through Lentävänniemi and completing the western branch.' },
]

const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) })
const cookie = login.headers.get('set-cookie')?.split(';')[0]
if (!cookie) throw new Error('login did not return a session')

for (const phase of phases) {
  const create = {
    nodes: nodes.filter((node) => nodePhase.get(node.id) === phase.number),
    ways: ways.filter((way) => wayPhase.get(way.id) === phase.number),
    relations: [...(relationsByPhase.get(phase.number) ?? []), ...(phase.number === 1 ? [{
      id: -13072753, version: 1,
      members: masterIDs.map((ref) => ({ type: 'relation' as const, ref, role: 'route' })),
      tags: { type: 'transport_system', name: 'Tampere', aliases: 'Tampere tramway;Tampereen raitiotie', mode: 'tram', start_date: '2021-08-09' },
    }] : [])],
  }
  const draft = await request('/api/osm/changesets', { method: 'POST', cookie, body: JSON.stringify({
    workspaceId: 'main', scopeId: 'tampere', date: phase.date, mode: 'tram', title: phase.title, summary: phase.summary,
    osmChange: { version: '0.6', generator: 'transporthistory', create },
  }) })
  const { id } = await draft.json() as { id: string }
  await request(`/api/changesets/${id}/submit`, { method: 'POST', cookie, body: '{}' })
  await request(`/api/changesets/${id}/publish`, { method: 'POST', cookie, body: '{}' })
  console.log(`published ${phase.date} ${id}: ${create.nodes.length} nodes, ${create.ways.length} ways, ${create.relations.length} relations`)
}
