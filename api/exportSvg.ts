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

export function buildMapSvg(
  features: NetworkFeature[],
  bounds: Bounds,
  zoom: number,
  width: number,
  height: number,
  basemap: boolean,
) {
  const [left, top] = worldPixel(bounds.west, bounds.north, zoom)
  const [right, bottom] = worldPixel(bounds.east, bounds.south, zoom)
  const scaleX = width / (right - left)
  const scaleY = height / (bottom - top)
  const point = ([lng, lat]: [number, number]) => {
    const [x, y] = worldPixel(lng, lat, zoom)
    return `${((x - left) * scaleX).toFixed(2)},${((y - top) * scaleY).toFixed(2)}`
  }
  const tiles: string[] = []
  if (basemap) {
    const minX = Math.floor(left / 256)
    const maxX = Math.floor(right / 256)
    const minY = Math.floor(top / 256)
    const maxY = Math.floor(bottom / 256)
    const count = 2 ** zoom
    for (let tileY = minY; tileY <= maxY; tileY += 1) {
      for (let tileX = minX; tileX <= maxX; tileX += 1) {
        const wrappedX = ((tileX % count) + count) % count
        tiles.push(`<image href="https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png" x="${((tileX * 256 - left) * scaleX).toFixed(2)}" y="${((tileY * 256 - top) * scaleY).toFixed(2)}" width="${(256 * scaleX).toFixed(2)}" height="${(256 * scaleY).toFixed(2)}" preserveAspectRatio="none"/>`)
      }
    }
  }
  const shapes: string[] = []
  for (const feature of features) {
    const color = escape(feature.properties.color || '#d7c4a3')
    const opacity = feature.properties.layer === 'route' ? 0.95 : 0.58
    const strokeWidth = feature.properties.layer === 'route' ? 4 : 2
    if (feature.geometry.type === 'Point') {
      const [cx, cy] = point(feature.geometry.coordinates).split(',')
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${color}" stroke="#fff" stroke-width="1"/>`)
      continue
    }
    const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates
    for (const line of lines) {
      shapes.push(`<polyline points="${line.map(point).join(' ')}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`)
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${basemap ? `<rect width="100%" height="100%" fill="#e5e2dc"/>${tiles.join('')}` : ''}
  <g>${shapes.join('')}</g>
  ${basemap ? `<text x="${width - 8}" y="${height - 8}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#333">© OpenStreetMap contributors</text>` : ''}
</svg>`
}
