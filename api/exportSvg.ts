import type { NetworkFeature } from './project.ts'

type Bounds = { west: number; south: number; east: number; north: number }

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char)
}

function worldPixel(lng: number, lat: number, zoom: number): [number, number] {
  const size = 256 * 2 ** zoom
  const x = ((lng + 180) / 360) * size
  const limited = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const sin = Math.sin((limited * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size
  return [x, y]
}

export async function buildMapSvg(
  features: NetworkFeature[],
  bounds: Bounds,
  zoom: number,
  width: number,
  height: number,
  basemap: boolean,
  places: Array<{ id: string; name: string; center: [number, number] }> = [],
) {
  const [left, top] = worldPixel(bounds.west, bounds.north, zoom)
  const [right, bottom] = worldPixel(bounds.east, bounds.south, zoom)
  const scaleX = width / (right - left)
  const scaleY = height / (bottom - top)
  const point = ([lng, lat]: [number, number]) => {
    const [x, y] = worldPixel(lng, lat, zoom)
    return `${((x - left) * scaleX).toFixed(2)},${((y - top) * scaleY).toFixed(2)}`
  }
  const projectedPoint = ([lng, lat]: [number, number]): [number, number] => {
    const [x, y] = worldPixel(lng, lat, zoom)
    return [(x - left) * scaleX, (y - top) * scaleY]
  }
  const tiles: string[] = []
  if (basemap) {
    const nativeZoom = Math.min(19, zoom)
    const tileSpan = 256 * 2 ** (zoom - nativeZoom)
    const minX = Math.floor(left / tileSpan)
    const maxX = Math.floor(right / tileSpan)
    const minY = Math.floor(top / tileSpan)
    const maxY = Math.floor(bottom / tileSpan)
    const count = 2 ** nativeZoom
    const requests: Array<Promise<string>> = []
    for (let tileY = minY; tileY <= maxY; tileY += 1) {
      for (let tileX = minX; tileX <= maxX; tileX += 1) {
        const wrappedX = ((tileX % count) + count) % count
        requests.push(tileImage(nativeZoom, wrappedX, tileY).then((href) =>
          `<image href="${href}" x="${((tileX * tileSpan - left) * scaleX).toFixed(2)}" y="${((tileY * tileSpan - top) * scaleY).toFixed(2)}" width="${(tileSpan * scaleX).toFixed(2)}" height="${(tileSpan * scaleY).toFixed(2)}" preserveAspectRatio="none"/>`))
      }
    }
    tiles.push(...await Promise.all(requests))
  }
  const shapes: string[] = []
  for (const feature of features) {
    const color = escape(feature.properties.color || '#d7c4a3')
    const isRoute = feature.properties.layer === 'route'
    const form = feature.properties.trackForm
    const scale = strokeScale(zoom)
    const opacity = isRoute ? 1 : form === 'double' ? 0.45 : 0.5
    const strokeWidth = Math.max(1.15, (form === 'double' ? 5 : form === 'single_oneway' ? 3.5 : 3) * scale)
    const dash = feature.properties.grade === 'tunnel' ? '10 8' : form === 'single_oneway' ? '12 8' : form === 'single_both' ? '10 5 2 5' : ''
    if (feature.geometry.type === 'Point') {
      const [cx, cy] = point(feature.geometry.coordinates).split(',')
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${color}" stroke="#fff" stroke-width="1"/>`)
      continue
    }
    const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates
    for (const line of lines) {
      shapes.push(`<polyline points="${line.map(point).join(' ')}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`)
      if (form === 'double') {
        shapes.push(`<polyline points="${line.map(point).join(' ')}" fill="none" stroke="#12171c" stroke-opacity="${isRoute ? 0.9 : 0.35}" stroke-width="${Math.max(1, 1.5 * scale)}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`)
      }
    }
  }
  const labels = zoom >= 12 ? routeLabels(features, projectedPoint, zoom) : []
  const placeShapes = places.map((place) => {
    const [cx, cy] = projectedPoint([place.center[1], place.center[0]])
    const label = zoom >= 5
      ? `<text x="${(cx + 10).toFixed(2)}" y="${(cy + 4).toFixed(2)}" font-family="sans-serif" font-size="12" font-weight="600" fill="#1c1814">${escape(place.name)}</text>`
      : ''
    return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${zoom < 5 ? 5 : 7}" fill="#d7c4a3" fill-opacity="0.95" stroke="#1c1814" stroke-width="2"/>${label}`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${basemap ? `<rect width="100%" height="100%" fill="#e5e2dc"/>${tiles.join('')}` : ''}
  <g>${shapes.join('')}</g>
  <g>${placeShapes.join('')}</g>
  <g>${labels.join('')}</g>
  ${basemap ? `<text x="${width - 8}" y="${height - 8}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#333">© OpenStreetMap contributors</text>` : ''}
</svg>`
}

function routeLabels(
  features: NetworkFeature[],
  project: (point: [number, number]) => [number, number],
  zoom: number,
) {
  const longest = new Map<string, { line: [number, number][]; length: number; text: string; color: string }>()
  for (const feature of features) {
    if (feature.properties.layer !== 'route' || !feature.properties.number || feature.geometry.type === 'Point') continue
    const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates
    for (const line of lines) {
      const projected = line.map(project)
      const length = projected.slice(1).reduce((sum, point, index) => sum + distance(projected[index]!, point), 0)
      const current = longest.get(feature.properties.lineId)
      if (!current || length > current.length) longest.set(feature.properties.lineId, {
        line, length, text: feature.properties.number, color: feature.properties.color,
      })
    }
  }
  const labels: string[] = []
  for (const item of longest.values()) {
    if (item.length < (zoom < 14 ? 36 : 24)) continue
    const sample = midpoint(item.line, project)
    if (!sample) continue
    const fontSize = zoom < 14 ? 10 : 11
    const pad = zoom < 14 ? 4 : 6
    const width = Math.max(18, item.text.length * fontSize * 0.68 + pad * 2)
    labels.push(`<g transform="translate(${sample.x.toFixed(2)} ${sample.y.toFixed(2)}) rotate(${sample.angle.toFixed(2)})"><rect x="${(-width / 2).toFixed(2)}" y="-17" width="${width.toFixed(2)}" height="16" rx="2" fill="#f4efe6" fill-opacity="0.94" stroke="${escape(item.color)}"/><text x="0" y="-5" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="600" fill="#1c1814">${escape(item.text)}</text></g>`)
  }
  return labels
}

function midpoint(line: [number, number][], project: (point: [number, number]) => [number, number]) {
  const points = line.map(project)
  const lengths = points.slice(1).map((point, index) => distance(points[index]!, point))
  const target = lengths.reduce((sum, value) => sum + value, 0) / 2
  let walked = 0
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!
    if (walked + length >= target) {
      const start = points[index]!
      const end = points[index + 1]!
      const ratio = length ? (target - walked) / length : 0
      let angle = Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI
      if (angle > 90 || angle < -90) angle += 180
      return { x: start[0] + (end[0] - start[0]) * ratio, y: start[1] + (end[1] - start[1]) * ratio, angle }
    }
    walked += length
  }
  return null
}

function distance(left: [number, number], right: [number, number]) {
  return Math.hypot(right[0] - left[0], right[1] - left[1])
}

function strokeScale(zoom: number) {
  if (zoom <= 12) return 1
  if (zoom >= 19) return 0.3
  return 1 - ((zoom - 12) / 7) * 0.7
}

async function tileImage(zoom: number, x: number, y: number) {
  const response = await fetch(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, {
    headers: { 'user-agent': 'transporthistory.net map export' },
  })
  if (!response.ok) throw new Error(`basemap tile ${zoom}/${x}/${y}: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer()).toString('base64')
  return `data:image/png;base64,${bytes}`
}
