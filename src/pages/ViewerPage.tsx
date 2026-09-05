import { useMemo, useState } from 'react'
import { HistoryPanel } from '../components/HistoryPanel'
import { MapStage, type ViewerFeature } from '../components/MapStage'
import { ModesPanel } from '../components/ModesPanel'
import { RoutesPanel } from '../components/RoutesPanel'
import { Timeline } from '../components/Timeline'
import { currentSnapshots, formatSnapshotDate, nearestDate, snapshotDates, snapshotsForCity } from '../data/snapshots'
import { useCatalog } from '../data/useCatalog'
import { useNetworkState } from '../data/useNetworkState'
import { diffNetwork, hasDiff } from '../map/diffNetwork'
import { infraAliveAt, infraWay, wayEnabled, type TransportMode } from '../types'

const initialModes: Record<TransportMode, boolean> = {
  metro: true,
  tram: true,
  trolleybus: false,
  bus: false,
}

export function ViewerPage() {
  const { catalog, error: catalogError } = useCatalog({ loadNetworks: false })
  const [date, setDate] = useState<string | null>(null)
  const [modes, setModes] = useState(initialModes)
  const [hiddenRoutes, setHiddenRoutes] = useState<Set<string>>(new Set())
  const [showChanges, setShowChanges] = useState(false)

  const city = catalog?.cities[0]
  const citySnapshots = useMemo(
    () => (catalog && city ? snapshotsForCity(catalog, city.id) : []),
    [catalog, city],
  )
  const dates = useMemo(() => {
    if (catalog?.dates?.length) {
      return catalog.dates
    }
    return snapshotDates(citySnapshots)
  }, [catalog, citySnapshots])
  const selectedDate = useMemo(() => {
    if (dates.length === 0) {
      return null
    }
    if (date && dates.includes(date)) {
      return date
    }
    if (date) {
      return nearestDate(dates, date)
    }
    return dates[0] ?? null
  }, [dates, date])
  const previousDate = useMemo(() => {
    if (!selectedDate) {
      return null
    }
    const index = dates.indexOf(selectedDate)
    return index > 0 ? (dates[index - 1] ?? null) : null
  }, [dates, selectedDate])
  const { state, error: stateError } = useNetworkState(city?.id, selectedDate)
  const { state: previous } = useNetworkState(city?.id, previousDate)
  const activeSnapshots = useMemo(
    () =>
      selectedDate
        ? currentSnapshots(state?.chronicles ?? citySnapshots, modes, selectedDate)
            .slice()
            .sort((left, right) => {
              const leftHit = left.date === selectedDate ? 0 : 1
              const rightHit = right.date === selectedDate ? 0 : 1
              return leftHit - rightHit || left.mode.localeCompare(right.mode)
            })
        : [],
    [citySnapshots, modes, selectedDate, state?.chronicles],
  )
  const listedRoutes = useMemo(
    () =>
      (state?.routes ?? []).filter(
        (route) => modes[route.mode] && (!selectedDate || infraAliveAt(route, selectedDate)),
      ),
    [modes, selectedDate, state?.routes],
  )
  const visibleRouteIds = useMemo(
    () => new Set(listedRoutes.filter((route) => !hiddenRoutes.has(route.id)).map((route) => route.id)),
    [hiddenRoutes, listedRoutes],
  )
  const routeLabels = useMemo(() => {
    const labels: Record<string, string[]> = {}
    const routes = listedRoutes.filter((route) => visibleRouteIds.has(route.id))
    for (const snapshot of activeSnapshots) {
      labels[snapshot.id] = [
        ...new Set(routes.filter((route) => route.mode === snapshot.mode).map((route) => route.number)),
      ].sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }))
    }
    return labels
  }, [activeSnapshots, listedRoutes, visibleRouteIds])
  const diff = useMemo(() => diffNetwork(previous, state), [previous, state])
  const baseFeatures = useMemo(
    () =>
      (state?.features ?? []).filter((feature) =>
        feature.properties.layer === 'route'
          ? visibleRouteIds.has(feature.properties.lineId)
          : wayEnabled(infraWay(feature.properties), modes),
      ),
    [modes, state?.features, visibleRouteIds],
  )
  const features = useMemo((): ViewerFeature[] => {
    const current: ViewerFeature[] = baseFeatures.map((feature) => ({
      ...feature,
      accent: showChanges ? accentFor(feature, diff) : undefined,
    }))
    if (!showChanges || !previous) {
      return current
    }
    const ghosts: ViewerFeature[] = previous.features
      .filter((feature) => {
        if (feature.properties.layer === 'route') {
          return diff.removedRoutes.has(feature.properties.lineId) && modes[feature.properties.mode]
        }
        return (
          Boolean(feature.properties.infraId) &&
          diff.removedInfra.has(feature.properties.infraId ?? '') &&
          wayEnabled(infraWay(feature.properties), modes)
        )
      })
      .map((feature) => ({ ...feature, accent: 'removed' as const }))
    return [...ghosts, ...current]
  }, [baseFeatures, diff, modes, previous, showChanges])

  const error = catalogError ?? stateError
  if (error) {
    return <p className="app-status">{error}</p>
  }

  if (!catalog || !city) {
    return <p className="app-status">Загрузка каталога…</p>
  }

  return (
    <div className="app">
      <MapStage city={city} features={features} highlight={showChanges} />
      <header className="brand">
        <p className="brand__kicker">Транспортная история</p>
        <h1 className="brand__title">{city.name}</h1>
      </header>
      <div className="side-dock">
        <ModesPanel
          modes={modes}
          onToggle={(mode) => setModes((current) => ({ ...current, [mode]: !current[mode] }))}
        />
        <RoutesPanel
          routes={listedRoutes}
          hidden={hiddenRoutes}
          onToggle={(id) => {
            setHiddenRoutes((current) => {
              const next = new Set(current)
              if (next.has(id)) {
                next.delete(id)
              } else {
                next.add(id)
              }
              return next
            })
          }}
          onSetMode={(mode, visible) => {
            setHiddenRoutes((current) => {
              const next = new Set(current)
              for (const route of listedRoutes) {
                if (route.mode !== mode) {
                  continue
                }
                if (visible) {
                  next.delete(route.id)
                } else {
                  next.add(route.id)
                }
              }
              return next
            })
          }}
        />
        <label className={showChanges ? 'hud-panel highlight-toggle is-on' : 'hud-panel highlight-toggle'}>
          <input
            type="checkbox"
            checked={showChanges}
            disabled={!previousDate}
            onChange={(event) => setShowChanges(event.target.checked)}
          />
          <span>
            Изменения
            {previousDate ? (
              <small>
                {hasDiff(diff) ? `с ${formatSnapshotDate(previousDate)}` : 'без отличий'}
              </small>
            ) : (
              <small>первая дата</small>
            )}
          </span>
        </label>
        <HistoryPanel date={selectedDate} snapshots={activeSnapshots} routeLabels={routeLabels} />
      </div>
      {selectedDate ? (
        <Timeline dates={dates} date={selectedDate} onDateChange={(next) => setDate(next)} />
      ) : null}
    </div>
  )
}

function accentFor(
  feature: ViewerFeature,
  diff: ReturnType<typeof diffNetwork>,
): ViewerFeature['accent'] {
  if (feature.properties.layer === 'route') {
    const id = feature.properties.lineId
    if (diff.addedRoutes.has(id)) {
      return 'added'
    }
    if (diff.changedRoutes.has(id)) {
      return 'changed'
    }
    const infraId = feature.properties.infraId
    if (infraId && diff.addedInfra.has(infraId)) {
      return 'added'
    }
    if (infraId && diff.changedInfra.has(infraId)) {
      return 'changed'
    }
    return undefined
  }
  const id = feature.properties.infraId ?? feature.properties.lineId
  if (diff.addedInfra.has(id)) {
    return 'added'
  }
  if (diff.changedInfra.has(id)) {
    return 'changed'
  }
  return undefined
}
