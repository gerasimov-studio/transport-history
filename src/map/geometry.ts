import L from 'leaflet'
import type { NetworkFeature, TransportMode } from '../types'

export const DOUBLE_TRACK_DETAIL_ZOOM = 14

export function doubleTrackVisibleGap(mode: TransportMode, zoom: number, selected = false): number {
  const base = selected ? 2.8 : 2.2
  return mode === 'trolleybus' ? base * 1.35 ** Math.max(0, zoom - DOUBLE_TRACK_DETAIL_ZOOM) : base
}

export function offsetPolyline(
  coords: [number, number][],
  offsetPixels: number,
  zoom: number,
  collapse: { start?: boolean; end?: boolean } = {},
): [number, number][] {
  if (coords.length < 2 || offsetPixels === 0) {
    return coords
  }
  let points = coords.map(([lng, lat]) => L.CRS.EPSG3857.latLngToPoint(L.latLng(lat, lng), zoom))
  const taper = Math.max(16, Math.abs(offsetPixels) * 4)
  if (collapse.start && points[0]!.distanceTo(points[1]!) > taper) {
    points = [points[0]!, interpolatePoint(points[0]!, points[1]!, taper), ...points.slice(1)]
  }
  if (collapse.end && points.at(-1)!.distanceTo(points.at(-2)!) > taper) {
    points = [...points.slice(0, -1), interpolatePoint(points.at(-1)!, points.at(-2)!, taper), points.at(-1)!]
  }
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)]!
    const next = points[Math.min(points.length - 1, index + 1)]!
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const length = Math.hypot(dx, dy)
    if (length === 0) {
      const latLng = L.CRS.EPSG3857.pointToLatLng(point, zoom)
      return [latLng.lng, latLng.lat]
    }
    const factor = (collapse.start && index === 0) || (collapse.end && index === points.length - 1) ? 0 : 1
    const shifted = L.point(point.x - (dy / length) * offsetPixels * factor, point.y + (dx / length) * offsetPixels * factor)
    const latLng = L.CRS.EPSG3857.pointToLatLng(shifted, zoom)
    return [latLng.lng, latLng.lat]
  })
}

function interpolatePoint(from: L.Point, to: L.Point, distance: number): L.Point {
  const length = from.distanceTo(to)
  const factor = length === 0 ? 0 : distance / length
  return L.point(from.x + (to.x - from.x) * factor, from.y + (to.y - from.y) * factor)
}

export function singleTrackJoins(
  feature: NetworkFeature,
  coordinates: [number, number][],
  features: NetworkFeature[],
): { start: boolean; end: boolean } {
  if (feature.properties.trackForm !== 'double' || coordinates.length < 2) {
    return { start: false, end: false }
  }
  const joined = [coordinates[0]!, coordinates.at(-1)!].map((endpoint) => features.some((candidate) => {
    if (
      candidate === feature || candidate.properties.kind !== 'track' ||
      candidate.properties.trackForm === 'double' || candidate.properties.layer !== feature.properties.layer ||
      candidate.properties.mode !== feature.properties.mode || candidate.properties.way !== feature.properties.way
    ) return false
    const lines = candidate.geometry.type === 'LineString'
      ? [candidate.geometry.coordinates]
      : candidate.geometry.type === 'MultiLineString' ? candidate.geometry.coordinates : []
    return lines.some((line) => line.length > 1 && line.some((point, index) =>
      sameCoordinate(endpoint, point) || (index > 0 && pointOnSegment(endpoint, line[index - 1]!, point)),
    ))
  }))
  return { start: joined[0]!, end: joined[1]! }
}

function sameCoordinate(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7
}

function pointOnSegment(point: [number, number], start: [number, number], end: [number, number]): boolean {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return sameCoordinate(point, start)
  const projection = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
  if (projection < 0 || projection > 1) return false
  return sameCoordinate(point, [start[0] + projection * dx, start[1] + projection * dy])
}

export function polylineLength(coords: [number, number][]): number {
  let total = 0
  for (let index = 1; index < coords.length; index += 1) {
    total += segmentLength(coords[index - 1]!, coords[index]!)
  }
  return total
}

export function alongPolyline(
  coords: [number, number][],
  fraction: number,
): { point: [number, number]; bearing: number } | null {
  if (coords.length < 2) {
    return null
  }
  const target = polylineLength(coords) * Math.min(1, Math.max(0, fraction))
  let walked = 0
  for (let index = 1; index < coords.length; index += 1) {
    const start = coords[index - 1]!
    const end = coords[index]!
    const length = segmentLength(start, end)
    if (walked + length >= target || index === coords.length - 1) {
      const rest = length === 0 ? 0 : (target - walked) / length
      return {
        point: [start[0] + (end[0] - start[0]) * rest, start[1] + (end[1] - start[1]) * rest],
        bearing: bearing(start, end),
      }
    }
    walked += length
  }
  return null
}

export function segmentLength(start: [number, number], end: [number, number]): number {
  const dx = (end[0] - start[0]) * Math.cos(((start[1] + end[1]) / 2) * (Math.PI / 180))
  const dy = end[1] - start[1]
  return Math.hypot(dx, dy)
}

export function bearing(start: [number, number], end: [number, number]): number {
  const y = Math.sin((end[0] - start[0]) * (Math.PI / 180)) * Math.cos(end[1] * (Math.PI / 180))
  const x =
    Math.cos(start[1] * (Math.PI / 180)) * Math.sin(end[1] * (Math.PI / 180)) -
    Math.sin(start[1] * (Math.PI / 180)) *
      Math.cos(end[1] * (Math.PI / 180)) *
      Math.cos((end[0] - start[0]) * (Math.PI / 180))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
