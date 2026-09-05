import L from 'leaflet'
import { alongPolyline, polylineLength } from './geometry'
import { LABELS_MIN_ZOOM } from './lod'
import type { NetworkFeature } from '../types'

export type SegmentLabel = {
  key: string
  point: [number, number]
  angle: number
  text: string
  color: string
}

export type RouteRibbon = {
  key: string
  coordinates: [number, number][]
  text: string
  color: string
}

const JOIN_EPS = 8e-5
const METERS_PER_DEGREE = 111_320

export function routeRibbons(features: NetworkFeature[]): RouteRibbon[] {
  const pieces = new Map<
    string,
    {
      coordinates: [number, number][]
      numbers: string[]
      color: string
    }
  >()

  for (const feature of features) {
    if (feature.properties.layer !== 'route' || feature.properties.kind !== 'track') {
      continue
    }
    const id = feature.properties.infraId
    if (!id) {
      continue
    }
    const parts =
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.type === 'MultiLineString'
          ? feature.geometry.coordinates
          : []
    for (const [partIndex, coordinates] of parts.entries()) {
      if (!coordinates || coordinates.length < 2) {
        continue
      }
      const key = `${id}:${partIndex}`
      const current = pieces.get(key) ?? {
        coordinates,
        numbers: [],
        color: feature.properties.color,
      }
      if (feature.properties.number && !current.numbers.includes(feature.properties.number)) {
        current.numbers.push(feature.properties.number)
      }
      pieces.set(key, current)
    }
  }

  const bySignature = new Map<string, { coordinates: [number, number][]; color: string; text: string }[]>()
  for (const piece of pieces.values()) {
    if (!piece.numbers.length) {
      continue
    }
    const text = piece.numbers
      .slice()
      .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
      .join(' · ')
    const signature = text
    const list = bySignature.get(signature) ?? []
    list.push({ coordinates: piece.coordinates, color: piece.color, text })
    bySignature.set(signature, list)
  }

  const ribbons: RouteRibbon[] = []
  for (const group of bySignature.values()) {
    const chains = joinChains(group.map((item) => item.coordinates))
    const color = group[0]?.color ?? '#c45c26'
    const text = group[0]?.text ?? ''
    chains.forEach((coordinates, index) => {
      ribbons.push({
        key: `${text}:${index}:${coordinates[0]?.join(',') ?? index}`,
        coordinates,
        text,
        color,
      })
    })
  }
  return ribbons
}

export function labelsForRibbons(
  ribbons: RouteRibbon[],
  zoom: number,
  bounds?: L.LatLngBounds,
): SegmentLabel[] {
  if (zoom < LABELS_MIN_ZOOM) {
    return []
  }
  const labels: SegmentLabel[] = []
  for (const ribbon of ribbons) {
    const box = ribbonBounds(ribbon.coordinates)
    if (bounds && box && !bounds.pad(0.3).intersects(box)) {
      continue
    }
    labels.push(...placeAlong(ribbon, zoom))
  }
  return labels
}

export function segmentLabels(features: NetworkFeature[], zoom = 14): SegmentLabel[] {
  return labelsForRibbons(routeRibbons(features), zoom)
}

function placeAlong(ribbon: RouteRibbon, zoom: number): SegmentLabel[] {
  const meters = polylineLength(ribbon.coordinates) * METERS_PER_DEGREE
  const lat = ribbon.coordinates[0]?.[1] ?? 60
  const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  const px = meters / metersPerPixel
  const minPx = zoom < 14 ? 36 : 24
  if (px < minPx) {
    return []
  }
  const spacing = zoom < 13 ? 380 : zoom < 15 ? 260 : zoom < 17 ? 200 : 160
  const count = Math.max(1, Math.floor(px / spacing))
  const labels: SegmentLabel[] = []
  for (let index = 1; index <= count; index += 1) {
    const sample = alongPolyline(ribbon.coordinates, index / (count + 1))
    if (!sample) {
      continue
    }
    labels.push({
      key: `${ribbon.key}:${index}`,
      point: sample.point,
      angle: uprightAngle(sample.bearing),
      text: ribbon.text,
      color: ribbon.color,
    })
  }
  return labels
}

function joinChains(lines: [number, number][][]): [number, number][][] {
  const remaining = lines.map((line) => line.slice())
  const chains: [number, number][][] = []
  while (remaining.length) {
    let chain = remaining.pop()!
    let found = true
    while (found) {
      found = false
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const joined = tryJoin(chain, remaining[index]!)
        if (joined) {
          chain = joined
          remaining.splice(index, 1)
          found = true
        }
      }
    }
    chains.push(chain)
  }
  return chains
}

function tryJoin(left: [number, number][], right: [number, number][]): [number, number][] | null {
  const leftStart = left[0]
  const leftEnd = left.at(-1)
  const rightStart = right[0]
  const rightEnd = right.at(-1)
  if (!leftStart || !leftEnd || !rightStart || !rightEnd) {
    return null
  }
  if (near(leftEnd, rightStart)) {
    return left.concat(right.slice(1))
  }
  if (near(leftEnd, rightEnd)) {
    return left.concat(right.slice(0, -1).reverse())
  }
  if (near(leftStart, rightEnd)) {
    return right.concat(left.slice(1))
  }
  if (near(leftStart, rightStart)) {
    return [...right].reverse().concat(left.slice(1))
  }
  return null
}

function near(left: [number, number], right: [number, number]): boolean {
  return Math.abs(left[0] - right[0]) < JOIN_EPS && Math.abs(left[1] - right[1]) < JOIN_EPS
}

function ribbonBounds(coordinates: [number, number][]): L.LatLngBounds | null {
  const points = coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
  return points.length ? L.latLngBounds(points) : null
}

function uprightAngle(bearing: number): number {
  let angle = bearing - 90
  if (angle > 90 || angle < -90) {
    angle += 180
  }
  return angle
}
