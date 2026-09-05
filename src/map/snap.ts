import L from 'leaflet'
import type { NetworkFeature, TrackGrade } from '../types'
import { sameGauge } from '../types'

export type SnapGraph = {
  vertices: [number, number][]
  endpoints: [number, number][]
  edges: Array<[[number, number], [number, number]]>
}

type SnapFeature = Pick<NetworkFeature, 'geometry'> & {
  key?: string
  properties: {
    way?: string
    gauge?: number
    grade?: TrackGrade
    level?: number
    kind: string
    layer?: string
    nodeKind?: string
  }
}

export type SnapMatch = {
  way: string
  gauge?: number
  grade?: TrackGrade | 'portal'
  level?: number
}

const MAX_PIXELS = 16
const TURN_STEP = 15

export function collectSnapGraph(
  features: SnapFeature[],
  match: SnapMatch,
  exclude?: { key: string; index: number },
): SnapGraph {
  const vertices: [number, number][] = []
  const endpoints: [number, number][] = []
  const edges: Array<[[number, number], [number, number]]> = []
  const drawingPortal = match.grade === 'portal'

  for (const feature of features) {
    if (feature.properties.layer === 'route') {
      continue
    }
    if (feature.properties.way && feature.properties.way !== match.way) {
      continue
    }
    if (match.way === 'rail' && match.gauge != null && feature.properties.gauge != null) {
      if (!sameGauge(feature.properties.gauge, match.gauge)) {
        continue
      }
    }
    if (!snapCompatible(feature, match, drawingPortal)) {
      continue
    }

    if (feature.geometry.type === 'Point') {
      vertices.push(feature.geometry.coordinates)
      endpoints.push(feature.geometry.coordinates)
      continue
    }

    const lines =
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.type === 'MultiLineString'
          ? feature.geometry.coordinates
          : []

    const featureGrade = feature.properties.grade ?? 'surface'
    const allowEdges = !drawingPortal && featureGrade !== 'tunnel'

    for (const line of lines) {
      line.forEach((coord, index) => {
        if (exclude && feature.key === exclude.key && index === exclude.index) {
          return
        }
        vertices.push(coord)
        if (index === 0 || index === line.length - 1) {
          endpoints.push(coord)
        }
        const next = line[index + 1]
        if (
          allowEdges &&
          next &&
          !(exclude && feature.key === exclude.key && index + 1 === exclude.index)
        ) {
          edges.push([coord, next])
        }
      })
    }
  }

  return { vertices, endpoints, edges }
}

function snapCompatible(feature: SnapFeature, match: SnapMatch, drawingPortal: boolean): boolean {
  if (feature.properties.kind === 'node' && feature.properties.nodeKind === 'portal') {
    return true
  }
  if (drawingPortal) {
    return true
  }
  const featureGrade = feature.properties.grade ?? 'surface'
  const matchGrade = match.grade === 'portal' ? 'surface' : (match.grade ?? 'surface')
  if (featureGrade !== matchGrade) {
    return false
  }
  if (featureGrade === 'tunnel') {
    return (feature.properties.level ?? -1) === (match.level ?? -1)
  }
  return true
}

export function snapDrawPoint(
  map: L.Map,
  point: [number, number],
  graph: SnapGraph,
  options: { lockTurns: boolean; from?: [number, number] },
): [number, number] {
  if (!options.lockTurns) {
    return point
  }
  const hooked =
    nearestOf(map, point, graph.endpoints, MAX_PIXELS) ??
    nearestOf(map, point, graph.vertices, MAX_PIXELS) ??
    nearestOnEdges(map, point, graph.edges, MAX_PIXELS)
  if (hooked) {
    return hooked
  }
  if (options.from) {
    return lockTurn(map, options.from, point)
  }
  return point
}

function nearestOf(
  map: L.Map,
  point: [number, number],
  candidates: [number, number][],
  maxPixels: number,
): [number, number] | null {
  const origin = toPoint(map, point)
  let best: [number, number] | null = null
  let bestDist = maxPixels
  for (const candidate of candidates) {
    const dist = origin.distanceTo(toPoint(map, candidate))
    if (dist <= bestDist) {
      bestDist = dist
      best = candidate
    }
  }
  return best
}

function nearestOnEdges(
  map: L.Map,
  point: [number, number],
  edges: Array<[[number, number], [number, number]]>,
  maxPixels: number,
): [number, number] | null {
  const origin = toPoint(map, point)
  let best: [number, number] | null = null
  let bestDist = maxPixels
  for (const [start, end] of edges) {
    const projected = projectPoint(origin, toPoint(map, start), toPoint(map, end))
    const dist = origin.distanceTo(projected)
    if (dist <= bestDist) {
      bestDist = dist
      const latlng = map.layerPointToLatLng(projected)
      best = [latlng.lng, latlng.lat]
    }
  }
  return best
}

function lockTurn(map: L.Map, from: [number, number], to: [number, number]): [number, number] {
  const start = toPoint(map, from)
  const end = toPoint(map, to)
  const dist = start.distanceTo(end)
  if (dist < 2) {
    return to
  }
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const step = (TURN_STEP * Math.PI) / 180
  const snapped = Math.round(angle / step) * step
  const next = L.point(start.x + Math.cos(snapped) * dist, start.y + Math.sin(snapped) * dist)
  const latlng = map.layerPointToLatLng(next)
  return [latlng.lng, latlng.lat]
}

function projectPoint(point: L.Point, start: L.Point, end: L.Point): L.Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = dx * dx + dy * dy
  if (length === 0) {
    return start
  }
  const t = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
  return L.point(start.x + dx * t, start.y + dy * t)
}

function toPoint(map: L.Map, coord: [number, number]): L.Point {
  return map.latLngToLayerPoint(L.latLng(coord[1], coord[0]))
}
