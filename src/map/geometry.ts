import L from 'leaflet'
import type { TransportMode } from '../types'

export const DOUBLE_TRACK_DETAIL_ZOOM = 14

export function doubleTrackVisibleGap(mode: TransportMode, zoom: number, selected = false): number {
  const base = selected ? 2.8 : 2.2
  return mode === 'trolleybus' ? base * 1.35 ** Math.max(0, zoom - DOUBLE_TRACK_DETAIL_ZOOM) : base
}

export function offsetPolyline(
  coords: [number, number][],
  offsetPixels: number,
  zoom: number,
): [number, number][] {
  if (coords.length < 2 || offsetPixels === 0) {
    return coords
  }
  const points = coords.map(([lng, lat]) => L.CRS.EPSG3857.latLngToPoint(L.latLng(lat, lng), zoom))
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)]!
    const next = points[Math.min(points.length - 1, index + 1)]!
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const length = Math.hypot(dx, dy)
    if (length === 0) {
      return coords[index]!
    }
    const shifted = L.point(point.x - (dy / length) * offsetPixels, point.y + (dx / length) * offsetPixels)
    const latLng = L.CRS.EPSG3857.pointToLatLng(shifted, zoom)
    return [latLng.lng, latLng.lat]
  })
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
