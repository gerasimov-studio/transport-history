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
