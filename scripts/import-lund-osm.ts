const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3001'
const username = process.env.EDITOR_USERNAME ?? 'editor'
const password = process.env.EDITOR_PASSWORD ?? 'editor'
const relationIDs = [12021098, 12021099, 14264835]

type Tags = Record<string, string>
type Node = { id: number; version: number; lat: number; lon: number; tags?: Tags }
type Way = { id: number; version: number; nodes: number[]; tags?: Tags }
type Member = { type: 'node' | 'way' | 'relation'; ref: number; role: string }
type Relation = { id: number; version: number; members: Member[]; tags?: Tags }

function decode(value: string) {
  return value.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
}

function attrs(raw: string) {
  return Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]))
}

function tags(body: string): Tags {
  return Object.fromEntries([...body.matchAll(/<tag\s+([^>]+)\/>/g)].map((m) => { const a = attrs(m[1]); return [a.k, a.v] }))
}

function parse(xml: string) {
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

async function request(path: string, init?: RequestInit & { cookie?: string }) {
  const headers = new Headers(init?.headers); headers.set('content-type', 'application/json'); if (init?.cookie) headers.set('cookie', init.cookie)
  const response = await fetch(baseURL + path, { ...init, headers }); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response
}

const documents = await Promise.all(relationIDs.map(async (id) => {
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/relation/${id}/full`, { headers: { 'user-agent': 'transporthistory/1.0' } })
  if (!response.ok) throw new Error(`OSM relation ${id}: ${response.status}`)
  return parse(await response.text())
}))
const unique = <T extends { id: number }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()]
const create = { nodes: unique(documents.flatMap((d) => d.nodes)), ways: unique(documents.flatMap((d) => d.ways)), relations: unique(documents.flatMap((d) => d.relations)) }
const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) })
const cookie = login.headers.get('set-cookie')?.split(';')[0]
if (!cookie) throw new Error('login did not return a session')
const draft = await request('/api/osm/changesets', { method: 'POST', cookie, body: JSON.stringify({ workspaceId: 'main', date: '2020-12-12', mode: 'tram', title: 'Lund tramway opened', summary: 'The 5.5 km double-track line between Lund C and ESS opened with nine stops.', osmChange: { version: '0.6', generator: 'transporthistory', create } }) })
const { id } = await draft.json() as { id: string }
await request(`/api/changesets/${id}/submit`, { method: 'POST', cookie, body: '{}' })
await request(`/api/changesets/${id}/publish`, { method: 'POST', cookie, body: '{}' })
console.log(`published ${id}: ${create.nodes.length} nodes, ${create.ways.length} ways, ${create.relations.length} relations`)
