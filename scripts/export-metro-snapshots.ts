import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { metroLines } from '../src/data/spb/metro.ts'
import type { MetroLine, NetworkCollection, NetworkFeature } from '../src/types.ts'

const dates = [
  '1955-11-15',
  '1963-07-01',
  '1984-12-28',
  '1997-09-15',
  '2012-12-28',
  '2024-09-02',
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const osmDir = join(root, 'db/seed/osm')

function nearestIndex(line: [number, number][], point: [number, number]): number {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < line.length; index += 1) {
    const [lng, lat] = line[index] ?? point
    const distance = (lng - point[0]) ** 2 + (lat - point[1]) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return best
}

function loadOsmLine(lineId: string): [number, number][] | null {
  try {
    const collection = JSON.parse(readFileSync(join(osmDir, `metro-line-${lineId}.geojson`), 'utf8')) as {
      features: Array<{ geometry: { type: string; coordinates: [number, number][] } }>
    }
    const geometry = collection.features[0]?.geometry
    if (geometry?.type !== 'LineString' || geometry.coordinates.length < 2) {
      return null
    }
    return geometry.coordinates
  } catch {
    return null
  }
}

function trackCoordinates(line: MetroLine, stations: MetroLine['stations']): [number, number][] {
  const osm = loadOsmLine(line.id)
  if (!osm || stations.length < 2) {
    return stations.map((station) => [station.lng, station.lat])
  }

  const indices = stations.map((station) => nearestIndex(osm, [station.lng, station.lat]))
  const start = Math.min(...indices)
  const end = Math.max(...indices)
  const clipped = osm.slice(start, end + 1)
  return clipped.length >= 2 ? clipped : stations.map((station) => [station.lng, station.lat])
}

function collectionForDate(date: string): NetworkCollection {
  const year = Number(date.slice(0, 4))
  const features: NetworkFeature[] = []

  for (const line of metroLines as MetroLine[]) {
    const stations = line.stations.filter((station) => station.since <= year)
    if (stations.length === 0) {
      continue
    }

    if (stations.length > 1) {
      features.push({
        type: 'Feature',
        properties: {
          kind: 'track',
          mode: 'metro',
          lineId: `spb-metro-${line.id}`,
          number: line.id,
          name: line.name,
          color: line.color,
          trackForm: 'double',
        },
        geometry: {
          type: 'LineString',
          coordinates: trackCoordinates(line, stations),
        },
      })
    }

    for (const station of stations) {
      features.push({
        type: 'Feature',
        properties: {
          kind: 'stop',
          mode: 'metro',
          lineId: `spb-metro-${line.id}`,
          number: line.id,
          name: station.name,
          color: line.color,
          trackForm: 'double',
        },
        geometry: {
          type: 'Point',
          coordinates: [station.lng, station.lat],
        },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

const outDirs = [join(root, 'db/seed'), join(root, 'public/data/spb/metro')]
for (const outDir of outDirs) {
  mkdirSync(outDir, { recursive: true })
}

for (const date of dates) {
  const body = `${JSON.stringify(collectionForDate(date), null, 2)}\n`
  for (const outDir of outDirs) {
    writeFileSync(join(outDir, `${date}.geojson`), body)
  }
}

console.log('wrote', dates.length, 'metro snapshots')
