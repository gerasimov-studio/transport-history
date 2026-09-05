import type { Catalog, Snapshot, TransportMode } from '../types'

export function snapshotsForCity(catalog: Catalog, cityId: string): Snapshot[] {
  return catalog.snapshots
    .filter((snapshot) => snapshot.city === cityId)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
}

export function snapshotDates(snapshots: Snapshot[]): string[] {
  return [...new Set(snapshots.map((snapshot) => snapshot.date))].sort()
}

export function nearestDate(dates: string[], date: string): string {
  return dates.reduce((best, item) =>
    Math.abs(Date.parse(item) - Date.parse(date)) <
    Math.abs(Date.parse(best) - Date.parse(date))
      ? item
      : best,
  )
}

export function currentSnapshots(
  snapshots: Snapshot[],
  modes: Record<TransportMode, boolean>,
  date: string,
): Snapshot[] {
  const current: Snapshot[] = []

  for (const mode of Object.keys(modes) as TransportMode[]) {
    if (!modes[mode]) {
      continue
    }

    const latest = snapshots
      .filter((snapshot) => snapshot.mode === mode && snapshot.date <= date)
      .sort((left, right) => left.date.localeCompare(right.date))
      .at(-1)

    if (latest) {
      current.push(latest)
    }
  }

  return current
}

export function formatSnapshotDate(date: string): string {
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) {
    return date
  }
  return `${day}.${month}.${year}`
}
