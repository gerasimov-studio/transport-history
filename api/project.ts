export type TransportMode = 'metro' | 'tram' | 'trolleybus' | 'bus'
export type TransportWay = 'rail' | 'road'
export type FeatureKind = 'track' | 'stop' | 'node'
export type TrackForm = 'double' | 'single_oneway' | 'single_both'
export type TrackGrade = 'surface' | 'tunnel'
export type NodeKind = 'junction' | 'terminus' | 'loop' | 'wye' | 'crossover' | 'portal'

export const WAY_MODES: Record<TransportWay, TransportMode[]> = {
  rail: ['metro', 'tram'],
  road: ['trolleybus', 'bus'],
}

export function wayOf(mode: TransportMode): TransportWay {
  return mode === 'metro' || mode === 'tram' ? 'rail' : 'road'
}

export function asWay(value: unknown): TransportWay | undefined {
  return value === 'rail' || value === 'road' ? value : undefined
}

export function asGauge(value: unknown): number | undefined {
  const mm = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(mm) || mm < 600 || mm > 3000) {
    return undefined
  }
  const rounded = Math.round(mm)
  return rounded === 1524 ? 1520 : rounded
}

export function defaultGauge(_mode?: TransportMode): number {
  return 1520
}

export function defaultMode(way: TransportWay): TransportMode {
  return WAY_MODES[way][0] ?? 'tram'
}

export function gaugeFromLegacy(_id: string, _mode?: TransportMode): number {
  return 1520
}

export function asDate(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

export function infraAliveAt(entity: { since?: string; until?: string }, date: string): boolean {
  if (entity.since && entity.since > date) {
    return false
  }
  if (entity.until && entity.until < date) {
    return false
  }
  return true
}

export function asGrade(value: unknown): TrackGrade | undefined {
  return value === 'surface' || value === 'tunnel' ? value : undefined
}

export function asLevel(value: unknown): number | undefined {
  const level = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(level) || level > -1 || level < -9) {
    return undefined
  }
  return level
}

export function infraGrade(entity: { way?: TransportWay; mode?: TransportMode; grade?: TrackGrade }): TrackGrade {
  const way = asWay(entity.way) ?? (entity.mode ? wayOf(entity.mode) : 'rail')
  if (way !== 'rail') {
    return 'surface'
  }
  return asGrade(entity.grade) ?? 'surface'
}

export function infraLevel(entity: { way?: TransportWay; mode?: TransportMode; grade?: TrackGrade; level?: number }): number {
  if (infraGrade(entity) === 'surface') {
    return 0
  }
  return asLevel(entity.level) ?? -1
}

export function normalizeRoute(entity: RouteEntity): RouteEntity {
  const since = asDate(entity.since)
  const until = asDate(entity.until)
  return {
    id: entity.id,
    mode: entity.mode,
    number: entity.number,
    name: entity.name,
    color: entity.color,
    segmentIds: entity.segmentIds,
    geometry: entity.mode === 'bus' ? entity.geometry : undefined,
    legs: entity.mode === 'trolleybus' ? normalizeRouteLegs(entity.legs) : undefined,
    since,
    until: until && since && until < since ? since : until,
  }
}

function normalizeRouteLegs(legs: RouteEntity['legs']): RouteEntity['legs'] {
  if (!Array.isArray(legs)) return undefined
  return legs.flatMap((leg) => {
    if (leg.type === 'wire' && Array.isArray(leg.segmentIds)) {
      return [{ type: 'wire' as const, segmentIds: leg.segmentIds.filter((id) => typeof id === 'string') }]
    }
    if (leg.type === 'autonomous' && leg.geometry?.type === 'LineString') {
      return [{ type: 'autonomous' as const, geometry: leg.geometry }]
    }
    return []
  })
}

export function normalizeInfra(entity: InfraEntity, fallbackWay: TransportWay = 'rail'): InfraEntity {
  const way = asWay(entity.way) ?? (entity.mode ? wayOf(entity.mode) : fallbackWay)
  const gauge = way === 'rail' ? asGauge(entity.gauge) ?? gaugeFromLegacy(entity.id, entity.mode) : undefined
  const since = asDate(entity.since)
  const until = asDate(entity.until)
  const grade = way === 'rail' ? infraGrade(entity) : undefined
  const level = way === 'rail' && grade === 'tunnel' ? infraLevel(entity) : undefined
  return {
    id: entity.id,
    kind: entity.kind,
    way,
    mode: entity.mode,
    gauge,
    grade,
    level,
    since,
    until: until && since && until < since ? since : until,
    name: entity.name,
    color: entity.color,
    trackForm: entity.trackForm,
    nodeKind: entity.nodeKind,
    geometry: entity.geometry,
  }
}

export type InfraEntity = {
  id: string
  kind: FeatureKind
  way: TransportWay
  mode?: TransportMode
  gauge?: number
  grade?: TrackGrade
  level?: number
  since?: string
  until?: string
  name: string
  color: string
  trackForm: TrackForm
  nodeKind?: NodeKind
  geometry:
    | { type: 'LineString'; coordinates: [number, number][] }
    | { type: 'MultiLineString'; coordinates: [number, number][][] }
    | { type: 'Point'; coordinates: [number, number] }
}

export type RouteEntity = {
  id: string
  mode: TransportMode
  number: string
  name: string
  color: string
  segmentIds: string[]
  geometry?: { type: 'LineString'; coordinates: [number, number][] }
  legs?: (
    | { type: 'wire'; segmentIds: string[] }
    | { type: 'autonomous'; geometry: { type: 'LineString'; coordinates: [number, number][] } }
  )[]
  since?: string
  until?: string
}

export type Chronicle = {
  id: string
  city: string
  mode: TransportMode
  date: string
  title: string
  summary: string
  network: string
}

export type NetworkFeature = {
  type: 'Feature'
  properties: {
    kind: FeatureKind
    mode: TransportMode
    lineId: string
    number: string
    name: string
    color: string
    trackForm: TrackForm
    nodeKind?: NodeKind
    layer?: 'infra' | 'route'
    infraId?: string
    way?: TransportWay
    gauge?: number
    grade?: TrackGrade
    level?: number
    since?: string
    until?: string
  }
  geometry: InfraEntity['geometry']
}

export type EventType =
  | 'infra.upsert'
  | 'infra.removed'
  | 'route.upsert'
  | 'route.removed'
  | 'chronicle.upsert'

export type StoredEvent = {
  id?: number
  type: EventType
  occurredOn: string
  cityId: string
  actor?: string | null
  payload: Record<string, unknown>
}

export type ProjectedState = {
  infra: Map<string, InfraEntity>
  routes: Map<string, RouteEntity>
  chronicles: Map<string, Chronicle>
}

export function emptyProjection(): ProjectedState {
  return {
    infra: new Map(),
    routes: new Map(),
    chronicles: new Map(),
  }
}

export function applyEvent(state: ProjectedState, event: StoredEvent): ProjectedState {
  const payload = event.payload
  if (event.type === 'infra.upsert') {
    const entity = normalizeInfra(payload as unknown as InfraEntity)
    state.infra.set(entity.id, entity)
  }
  if (event.type === 'infra.removed' && typeof payload.id === 'string') {
    state.infra.delete(payload.id)
  }
  if (event.type === 'route.upsert') {
    const entity = normalizeRoute(payload as unknown as RouteEntity)
    state.routes.set(entity.id, entity)
  }
  if (event.type === 'route.removed' && typeof payload.id === 'string') {
    state.routes.delete(payload.id)
  }
  if (event.type === 'chronicle.upsert') {
    const chronicle = payload as unknown as Chronicle
    state.chronicles.set(`${chronicle.mode}:${chronicle.date}`, chronicle)
  }
  return state
}

export function projectEvents(events: StoredEvent[], viewDate?: string): ProjectedState {
  const state = emptyProjection()
  for (const event of events) {
    if (viewDate && event.type === 'chronicle.upsert' && event.occurredOn > viewDate) {
      continue
    }
    applyEvent(state, event)
  }
  return state
}

export function chronicleAt(state: ProjectedState, mode: string, date: string): Chronicle | undefined {
  return [...state.chronicles.values()]
    .filter((item) => item.mode === mode && item.date <= date)
    .sort((left, right) => left.date.localeCompare(right.date))
    .at(-1)
}

export function renderFeatures(
  state: ProjectedState,
  modes?: Partial<Record<TransportMode, boolean>>,
  date?: string,
): NetworkFeature[] {
  const allowedMode = (mode: TransportMode) => !modes || modes[mode] !== false
  const allowedWay = (way: TransportWay) => WAY_MODES[way].some((mode) => allowedMode(mode))
  const features: NetworkFeature[] = []

  for (const entity of state.infra.values()) {
    if (!allowedWay(entity.way)) {
      continue
    }
    if (date && !infraAliveAt(entity, date)) {
      continue
    }
    features.push(infraFeature(entity))
  }

  for (const route of state.routes.values()) {
    if (!allowedMode(route.mode)) {
      continue
    }
    if (date && !infraAliveAt(route, date)) {
      continue
    }
    if (route.legs?.length) {
      for (const leg of route.legs) {
        if (leg.type === 'autonomous' && leg.geometry.coordinates.length >= 2) {
          features.push({
            type: 'Feature',
            properties: {
              kind: 'track', mode: route.mode, lineId: route.id, number: route.number,
              name: route.name, color: route.color, trackForm: 'single_both', layer: 'route',
              way: 'road', propulsion: 'autonomous', since: route.since, until: route.until,
            },
            geometry: leg.geometry,
          })
        }
        if (leg.type === 'wire') {
          for (const segmentId of leg.segmentIds) {
            pushRouteSegment(features, state, route, segmentId, date)
          }
        }
      }
      continue
    }
    if (route.geometry && route.geometry.coordinates.length >= 2) {
      features.push({
        type: 'Feature',
        properties: {
          kind: 'track', mode: route.mode, lineId: route.id, number: route.number,
          name: route.name, color: route.color, trackForm: 'single_both', layer: 'route',
          way: 'road', since: route.since, until: route.until,
        },
        geometry: route.geometry,
      })
      continue
    }
    for (const segmentId of route.segmentIds) {
      pushRouteSegment(features, state, route, segmentId, date)
    }
  }

  return features
}

function pushRouteSegment(
  features: NetworkFeature[], state: ProjectedState, route: RouteEntity, segmentId: string, date?: string,
) {
  const segment = state.infra.get(segmentId)
  if (!segment || segment.kind !== 'track' || (date && !infraAliveAt(segment, date))) return
  features.push({
    type: 'Feature', geometry: segment.geometry,
    properties: {
      kind: 'track', mode: route.mode, lineId: route.id, number: route.number,
      name: route.name, color: route.color, trackForm: segment.trackForm, layer: 'route',
      infraId: segment.id, way: segment.way, gauge: segment.gauge, grade: segment.grade,
      level: segment.level, propulsion: route.mode === 'trolleybus' ? 'wire' : undefined,
      since: route.since, until: route.until,
    },
  })
}

export function infraFeature(entity: InfraEntity): NetworkFeature {
  return {
    type: 'Feature',
    properties: {
      kind: entity.kind,
      mode: entity.mode ?? defaultMode(entity.way),
      lineId: entity.id,
      number: '',
      name: entity.name,
      color: entity.color,
      trackForm: entity.trackForm,
      nodeKind: entity.nodeKind,
      layer: 'infra',
      infraId: entity.id,
      way: entity.way,
      gauge: entity.gauge,
      grade: entity.grade,
      level: entity.level,
      since: entity.since,
      until: entity.until,
    },
    geometry: entity.geometry,
  }
}

export function diffAndBuildEvents(input: {
  cityId: string
  date: string
  way: TransportWay
  mode: TransportMode
  actor: string
  before: ProjectedState
  infra: InfraEntity[]
  routes: RouteEntity[]
  title: string
  summary: string
}): StoredEvent[] {
  const events: StoredEvent[] = []
  const beforeInfra = new Map(
    [...input.before.infra.entries()]
      .map(([id, entity]) => [id, normalizeInfra(entity, input.way)] as const)
      .filter(([, entity]) => entity.way === input.way),
  )
  const beforeRoutes = new Map(
    [...input.before.routes.entries()]
      .map(([id, entity]) => [id, normalizeRoute(entity)] as const)
      .filter(([, entity]) => entity.mode === input.mode),
  )
  const afterInfra = new Map(
    input.infra.map((entity) => {
      const normalized = normalizeInfra(entity, input.way)
      return [normalized.id, normalized] as const
    }),
  )
  const afterRoutes = new Map(input.routes.map((entity) => {
    const normalized = normalizeRoute(entity)
    return [normalized.id, normalized] as const
  }))

  for (const entity of afterInfra.values()) {
    const previous = beforeInfra.get(entity.id)
    if (!previous || serialize(previous) !== serialize(entity)) {
      events.push(baseEvent(input, 'infra.upsert', entity as unknown as Record<string, unknown>))
    }
  }
  for (const id of beforeInfra.keys()) {
    if (!afterInfra.has(id)) {
      events.push(baseEvent(input, 'infra.removed', { id }))
    }
  }

  for (const entity of afterRoutes.values()) {
    const previous = beforeRoutes.get(entity.id)
    if (!previous || serialize(previous) !== serialize(entity)) {
      events.push(baseEvent(input, 'route.upsert', entity as unknown as Record<string, unknown>))
    }
  }
  for (const id of beforeRoutes.keys()) {
    if (!afterRoutes.has(id)) {
      events.push(baseEvent(input, 'route.removed', { id }))
    }
  }

  const previousChronicle = chronicleAt(input.before, input.mode, input.date)
  const nextChronicle: Chronicle = {
    id: `${input.cityId}-${input.mode}-${input.date}`,
    city: input.cityId,
    mode: input.mode,
    date: input.date,
    title: input.title,
    summary: input.summary,
    network: '',
  }
  if (
    input.title.trim() &&
    (!previousChronicle ||
      previousChronicle.title !== nextChronicle.title ||
      previousChronicle.summary !== nextChronicle.summary ||
      previousChronicle.date !== nextChronicle.date)
  ) {
    events.push(baseEvent(input, 'chronicle.upsert', nextChronicle as unknown as Record<string, unknown>))
  }

  return events
}

function baseEvent(
  input: { cityId: string; date: string; actor: string },
  type: EventType,
  payload: Record<string, unknown>,
): StoredEvent {
  return {
    type,
    occurredOn: input.date,
    cityId: input.cityId,
    actor: input.actor,
    payload,
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

export function migratedInfraId(city: string, mode: string, kind: FeatureKind, featureId: number): string {
  return `infra:${city}:${mode}:${kind}:${featureId}`
}

export function migratedRouteId(city: string, mode: string, number: string): string {
  return `route:${city}:${mode}:${number}`
}

export function asTrackForm(value: unknown, hint?: string): TrackForm {
  if (value === 'double' || value === 'single_oneway' || value === 'single_both') {
    return value
  }
  return hint === 'metro' ? 'double' : 'single_both'
}

export function asNodeKind(value: unknown): NodeKind | undefined {
  if (
    value === 'junction' ||
    value === 'terminus' ||
    value === 'loop' ||
    value === 'wye' ||
    value === 'crossover' ||
    value === 'portal'
  ) {
    return value
  }
  return undefined
}
