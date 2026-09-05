import { infraAliveAt, type InfraEntity, type NetworkState, type RouteEntity } from '../types'

export type NetworkDiff = {
  addedInfra: Set<string>
  removedInfra: Set<string>
  changedInfra: Set<string>
  addedRoutes: Set<string>
  removedRoutes: Set<string>
  changedRoutes: Set<string>
}

const emptyDiff = (): NetworkDiff => ({
  addedInfra: new Set(),
  removedInfra: new Set(),
  changedInfra: new Set(),
  addedRoutes: new Set(),
  removedRoutes: new Set(),
  changedRoutes: new Set(),
})

export function diffNetwork(previous: NetworkState | null, current: NetworkState | null): NetworkDiff {
  if (!current) {
    return emptyDiff()
  }
  if (!previous) {
    return emptyDiff()
  }

  const beforeInfra = new Map(
    previous.infra.filter((entity) => infraAliveAt(entity, previous.date)).map((entity) => [entity.id, entity]),
  )
  const afterInfra = new Map(
    current.infra.filter((entity) => infraAliveAt(entity, current.date)).map((entity) => [entity.id, entity]),
  )
  const beforeRoutes = new Map(
    previous.routes.filter((entity) => infraAliveAt(entity, previous.date)).map((entity) => [entity.id, entity]),
  )
  const afterRoutes = new Map(
    current.routes.filter((entity) => infraAliveAt(entity, current.date)).map((entity) => [entity.id, entity]),
  )

  return {
    addedInfra: onlyIn(afterInfra, beforeInfra),
    removedInfra: onlyIn(beforeInfra, afterInfra),
    changedInfra: changedIn(beforeInfra, afterInfra, fingerprintInfra),
    addedRoutes: onlyIn(afterRoutes, beforeRoutes),
    removedRoutes: onlyIn(beforeRoutes, afterRoutes),
    changedRoutes: changedIn(beforeRoutes, afterRoutes, fingerprintRoute),
  }
}

export function hasDiff(diff: NetworkDiff): boolean {
  return (
    diff.addedInfra.size +
      diff.removedInfra.size +
      diff.changedInfra.size +
      diff.addedRoutes.size +
      diff.removedRoutes.size +
      diff.changedRoutes.size >
    0
  )
}

function onlyIn<T>(left: Map<string, T>, right: Map<string, T>): Set<string> {
  const ids = new Set<string>()
  for (const id of left.keys()) {
    if (!right.has(id)) {
      ids.add(id)
    }
  }
  return ids
}

function changedIn<T>(before: Map<string, T>, after: Map<string, T>, fingerprint: (value: T) => string): Set<string> {
  const ids = new Set<string>()
  for (const [id, next] of after) {
    const previous = before.get(id)
    if (previous && fingerprint(previous) !== fingerprint(next)) {
      ids.add(id)
    }
  }
  return ids
}

function fingerprintInfra(entity: InfraEntity): string {
  return JSON.stringify([
    entity.kind,
    entity.name,
    entity.color,
    entity.trackForm,
    entity.nodeKind,
    entity.gauge,
    entity.grade,
    entity.level,
    entity.since,
    entity.until,
    entity.geometry,
  ])
}

function fingerprintRoute(entity: RouteEntity): string {
  return JSON.stringify([entity.number, entity.name, entity.color, entity.segmentIds, entity.since, entity.until])
}
