import type { NetworkFeature } from '../types'

const JOIN_EPSILON = 1e-7

type Line = [number, number][]

type Edge = {
  coordinates: Line
  start: string
  end: string
}

/**
 * Builds disposable drawing geometry from canonical route-to-infrastructure
 * references. OSM way boundaries are storage details and must not appear as
 * breaks in a passenger route.
 */
export function routeRenderFeatures<T extends NetworkFeature>(features: T[]): T[] {
  const passthrough: T[] = []
  const groups = new Map<string, { sample: T; lines: Line[] }>()

  for (const feature of features) {
    if (
      feature.properties.layer !== 'route' ||
      !feature.properties.infraId ||
      (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString')
    ) {
      passthrough.push(feature)
      continue
    }

    const signature = routeStyleSignature(feature)
    const group = groups.get(signature) ?? { sample: feature, lines: [] }
    if (feature.geometry.type === 'LineString') {
      group.lines.push(feature.geometry.coordinates)
    } else {
      group.lines.push(...feature.geometry.coordinates)
    }
    groups.set(signature, group)
  }

  for (const group of groups.values()) {
    joinLineChains(group.lines).forEach((coordinates, index) => {
      const sample = group.sample as T & { key?: string }
      const rendered = {
        ...sample,
        ...(sample.key ? { key: `${sample.key}:route-chain:${index}` } : {}),
        properties: { ...sample.properties, infraId: undefined },
        geometry: { type: 'LineString' as const, coordinates },
      } as T
      passthrough.push(rendered)
    })
  }

  return passthrough
}

export function joinLineChains(lines: Line[]): Line[] {
  const edges = lines
    .filter((line) => line.length >= 2)
    .map((coordinates) => ({
      coordinates: coordinates.slice(),
      start: pointKey(coordinates[0]!),
      end: pointKey(coordinates.at(-1)!),
    }))
  const atNode = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    addEdge(atNode, edge.start, index)
    addEdge(atNode, edge.end, index)
  })

  const unused = new Set(edges.map((_, index) => index))
  const chains: Line[] = []
  const starts = edges.flatMap((edge, index) =>
    [edge.start, edge.end]
      .filter((node) => (atNode.get(node)?.length ?? 0) !== 2)
      .map((node) => ({ index, node })),
  )

  for (const start of starts) {
    if (unused.has(start.index)) {
      chains.push(walkChain(start.index, start.node, edges, atNode, unused))
    }
  }
  while (unused.size) {
    const index = unused.values().next().value as number
    chains.push(walkChain(index, edges[index]!.start, edges, atNode, unused))
  }
  return chains
}

function walkChain(
  first: number,
  from: string,
  edges: Edge[],
  atNode: Map<string, number[]>,
  unused: Set<number>,
): Line {
  let index = first
  let node = from
  let result: Line = []

  while (unused.has(index)) {
    unused.delete(index)
    const edge = edges[index]!
    const forwards = edge.start === node
    const coordinates = forwards ? edge.coordinates : edge.coordinates.slice().reverse()
    result = result.length ? result.concat(coordinates.slice(1)) : coordinates.slice()
    node = forwards ? edge.end : edge.start
    const next = (atNode.get(node) ?? []).filter((candidate) => unused.has(candidate))
    if ((atNode.get(node)?.length ?? 0) !== 2 || next.length !== 1) break
    index = next[0]!
  }
  return result
}

function addEdge(nodes: Map<string, number[]>, key: string, edge: number) {
  const list = nodes.get(key) ?? []
  list.push(edge)
  nodes.set(key, list)
}

function pointKey([lng, lat]: [number, number]) {
  return `${Math.round(lng / JOIN_EPSILON)},${Math.round(lat / JOIN_EPSILON)}`
}

function routeStyleSignature(feature: NetworkFeature) {
  const props = feature.properties
  const accent = 'accent' in feature ? String(feature.accent ?? '') : ''
  return [
    props.lineId,
    props.number,
    props.color,
    props.trackForm,
    props.way,
    props.grade,
    props.level,
    props.propulsion,
    accent,
  ].join('|')
}
