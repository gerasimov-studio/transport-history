export type TransportMode = 'metro' | 'tram' | 'trolleybus' | 'bus'

export type TransportWay = 'rail' | 'road'

export type EditorLayer = 'infra' | 'route'

export type FeatureKind = 'track' | 'stop' | 'node'

export type TrackForm = 'double' | 'single_oneway' | 'single_both'

export type NodeKind = 'junction' | 'terminus' | 'loop' | 'wye' | 'crossover' | 'portal'

export type TrackGrade = 'surface' | 'tunnel'

export const TRANSPORT_MODES: { id: TransportMode; label: string }[] = [
  { id: 'metro', label: 'Метро' },
  { id: 'tram', label: 'Трамвай' },
  { id: 'trolleybus', label: 'Троллейбус' },
  { id: 'bus', label: 'Автобус' },
]

export const TRANSPORT_WAYS: { id: TransportWay; label: string }[] = [
  { id: 'rail', label: 'Рельсовый' },
  { id: 'road', label: 'Дорожный' },
]

export const WAY_MODES: Record<TransportWay, TransportMode[]> = {
  rail: ['metro', 'tram'],
  road: ['trolleybus', 'bus'],
}

export const MODE_COLORS: Record<TransportMode, string> = {
  metro: '#d6083b',
  tram: '#c45c26',
  trolleybus: '#2e7d4f',
  bus: '#3d6ea8',
}

export const WAY_COLORS: Record<TransportWay, string> = {
  rail: '#8b9098',
  road: '#6b746c',
}

export const GAUGE_PRESETS: { mm: number; label: string }[] = [
  { mm: 1520, label: '1520 мм · русская' },
  { mm: 1435, label: '1435 мм · европейская' },
  { mm: 1000, label: '1000 мм · метровая' },
]

export const TRACK_FORMS: { id: TrackForm; label: string }[] = [
  { id: 'double', label: 'Двухпутная' },
  { id: 'single_oneway', label: 'Однопутная, в одну сторону' },
  { id: 'single_both', label: 'Однопутная, в обе стороны' },
]

export const ROAD_TRACK_FORMS: { id: TrackForm; label: string }[] = [
  { id: 'double', label: 'Двусторонняя' },
  { id: 'single_oneway', label: 'Односторонняя' },
  { id: 'single_both', label: 'В обе стороны' },
]

export const NODE_KINDS: { id: NodeKind; label: string; geometry: 'Point' | 'LineString' }[] = [
  { id: 'junction', label: 'Узел / разъезд', geometry: 'Point' },
  { id: 'terminus', label: 'Конечная', geometry: 'Point' },
  { id: 'portal', label: 'Выход на поверхность', geometry: 'Point' },
  { id: 'loop', label: 'Оборотное кольцо', geometry: 'LineString' },
  { id: 'wye', label: 'Треугольник', geometry: 'LineString' },
  { id: 'crossover', label: 'Съезд', geometry: 'LineString' },
]

export const TRACK_GRADES: { id: TrackGrade; label: string }[] = [
  { id: 'surface', label: 'На земле' },
  { id: 'tunnel', label: 'Тоннель' },
]

export const TUNNEL_LEVELS = [-1, -2, -3, -4]

export type Snapshot = {
  id: string
  city: string
  mode: TransportMode
  date: string
  title: string
  summary: string
  source?: string
  network: string
}

export type CatalogCity = {
  id: string
  name: string
  aliases: string[]
  center: [number, number]
  zoom: number
  minZoom: number
  maxZoom: number
}

export type CatalogLine = {
  id: string
  city: string
  mode: TransportMode
  number: string
  name: string
  color: string
}

export type Catalog = {
  cities: CatalogCity[]
  lines: CatalogLine[]
  modeCodes: Record<string, TransportMode>
  dates: string[]
  snapshots: Snapshot[]
}

export type NetworkProperties = {
  kind: FeatureKind
  mode: TransportMode
  lineId: string
  number: string
  name: string
  color: string
  trackForm: TrackForm
  nodeKind?: NodeKind
  layer?: EditorLayer
  infraId?: string
  way?: TransportWay
  gauge?: number
  grade?: TrackGrade
  level?: number
  since?: string
  until?: string
}

export type NetworkFeature = {
  type: 'Feature'
  properties: NetworkProperties
  geometry:
    | { type: 'LineString'; coordinates: [number, number][] }
    | { type: 'MultiLineString'; coordinates: [number, number][][] }
    | { type: 'Point'; coordinates: [number, number] }
}

export type NetworkCollection = {
  type: 'FeatureCollection'
  features: NetworkFeature[]
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
  geometry: NetworkFeature['geometry']
}

export type RouteEntity = {
  id: string
  mode: TransportMode
  number: string
  name: string
  color: string
  segmentIds: string[]
  since?: string
  until?: string
}

export type NetworkState = {
  city: string
  date: string
  infra: InfraEntity[]
  routes: RouteEntity[]
  chronicles: Snapshot[]
  features: NetworkFeature[]
}

export type Station = {
  id: string
  name: string
  since: number
  lat: number
  lng: number
}

export type MetroLine = {
  id: string
  name: string
  color: string
  stations: Station[]
}

export type ParsedSourceName = {
  cityAlias: string
  modeCode: string
  date: string
}

export function modeLabel(mode: TransportMode): string {
  return TRANSPORT_MODES.find((item) => item.id === mode)?.label ?? mode
}

export function wayLabel(way: TransportWay): string {
  return TRANSPORT_WAYS.find((item) => item.id === way)?.label ?? way
}

export function wayOf(mode: TransportMode): TransportWay {
  return mode === 'metro' || mode === 'tram' ? 'rail' : 'road'
}

export function defaultMode(way: TransportWay): TransportMode {
  return WAY_MODES[way][0] ?? 'tram'
}

export function modesForWay(way: TransportWay): TransportMode[] {
  return WAY_MODES[way]
}

export function infraWay(entity: { way?: TransportWay; mode?: TransportMode }): TransportWay {
  return entity.way ?? (entity.mode ? wayOf(entity.mode) : 'rail')
}

export function defaultGauge(_mode?: TransportMode): number {
  return 1520
}

export function canonicalGauge(mm: number): number {
  return mm === 1524 ? 1520 : mm
}

export function sameGauge(left?: number, right?: number): boolean {
  if (left == null || right == null) {
    return left === right
  }
  return canonicalGauge(left) === canonicalGauge(right)
}

export function gaugeFromLegacy(_id: string, _mode?: TransportMode): number {
  return 1520
}

export function infraGauge(entity: { id: string; way?: TransportWay; mode?: TransportMode; gauge?: number }): number | undefined {
  if (infraWay(entity) !== 'rail') {
    return undefined
  }
  if (typeof entity.gauge === 'number' && entity.gauge > 0) {
    return canonicalGauge(Math.round(entity.gauge))
  }
  return 1520
}

export function asGrade(value: unknown): TrackGrade | undefined {
  return value === 'surface' || value === 'tunnel' ? value : undefined
}

export function infraGrade(entity: {
  way?: TransportWay
  mode?: TransportMode
  grade?: TrackGrade
  nodeKind?: NodeKind
}): TrackGrade {
  if (infraWay(entity) !== 'rail') {
    return 'surface'
  }
  return asGrade(entity.grade) ?? 'surface'
}

export function infraLevel(entity: {
  way?: TransportWay
  mode?: TransportMode
  grade?: TrackGrade
  level?: number
  nodeKind?: NodeKind
}): number {
  if (infraWay(entity) !== 'rail' || infraGrade(entity) === 'surface') {
    return 0
  }
  if (typeof entity.level === 'number' && Number.isInteger(entity.level) && entity.level <= -1 && entity.level >= -9) {
    return entity.level
  }
  return -1
}

export function isPortalNode(entity: { kind?: FeatureKind; nodeKind?: NodeKind }): boolean {
  return entity.kind === 'node' && entity.nodeKind === 'portal'
}

export function sameGrade(left?: TrackGrade, right?: TrackGrade): boolean {
  return (left ?? 'surface') === (right ?? 'surface')
}

export function gradeLabel(grade: TrackGrade): string {
  return TRACK_GRADES.find((item) => item.id === grade)?.label ?? grade
}

export function levelLabel(level: number): string {
  return level === 0 ? 'земля' : `ярус ${level}`
}

export function gaugeLabel(mm: number): string {
  const canonical = canonicalGauge(mm)
  return GAUGE_PRESETS.find((item) => item.mm === canonical)?.label ?? `${canonical} мм`
}

export function gaugeColor(mm: number): string {
  const canonical = canonicalGauge(mm)
  if (canonical === 1520) {
    return '#8b9098'
  }
  if (canonical === 1435) {
    return '#9a8f7c'
  }
  if (canonical === 1000) {
    return '#6f8476'
  }
  return '#8b9098'
}

export function wayEnabled(way: TransportWay, modes: Record<TransportMode, boolean>): boolean {
  return WAY_MODES[way].some((mode) => modes[mode])
}

export function trackFormsForWay(way: TransportWay): { id: TrackForm; label: string }[] {
  return way === 'road' ? ROAD_TRACK_FORMS : TRACK_FORMS
}

export function nodeKindsForWay(way: TransportWay) {
  if (way === 'road') {
    return NODE_KINDS.filter((item) => item.id === 'junction' || item.id === 'terminus' || item.id === 'loop')
  }
  return NODE_KINDS
}

export function trackFormLabel(form: TrackForm, way?: TransportWay): string {
  return (way ? trackFormsForWay(way) : TRACK_FORMS).find((item) => item.id === form)?.label ?? form
}

export function nodeKindLabel(kind: NodeKind): string {
  return NODE_KINDS.find((item) => item.id === kind)?.label ?? kind
}

export function lineKey(city: string, mode: string, number: string): string {
  return `${city}-${mode}-${number.trim() || '1'}`
}

export function numberFromLineId(lineId: string, city: string, mode: string): string {
  const prefix = `${city}-${mode}-`
  if (lineId.startsWith(prefix)) {
    return lineId.slice(prefix.length)
  }
  return lineId.replace(/^(tm-|line-)/, '') || lineId
}

export function nodeDrawsLine(kind: NodeKind): boolean {
  return NODE_KINDS.find((item) => item.id === kind)?.geometry === 'LineString'
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

export function periodsOverlap(
  left: { since?: string; until?: string },
  right: { since?: string; until?: string },
): boolean {
  const leftStart = left.since ?? '0000-01-01'
  const leftEnd = left.until ?? '9999-12-31'
  const rightStart = right.since ?? '0000-01-01'
  const rightEnd = right.until ?? '9999-12-31'
  return leftStart <= rightEnd && rightStart <= leftEnd
}

export function validityLabel(since?: string, until?: string): string {
  if (!since) {
    return ''
  }
  const from = since.slice(0, 4)
  if (!until) {
    return `с ${from} — н.в.`
  }
  const to = until.slice(0, 4)
  return from === to ? from : `${from}–${to}`
}
