import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { FeatureKind, MapViewport, NetworkFeature, NetworkProperties, NetworkState, RouteEntity, Snapshot, MapPlace } from '../types'

type RenderStyle = Pick<NetworkProperties, 'mode' | 'color'> & Partial<Pick<NetworkProperties,
  'trackForm' | 'way' | 'gauge' | 'grade' | 'level' | 'propulsion'>>
type RenderFeature = {
  id: string
  style: number
  kind?: FeatureKind
  name?: string
  number?: string
  nodeKind?: NetworkProperties['nodeKind']
  facilityKind?: NetworkProperties['facilityKind']
  stationId?: string
  trackId?: string
  stopGroupId?: string
  stopDirection?: NetworkProperties['stopDirection']
  platformPoint?: [number, number]
  since?: string
  until?: string
  geometry: NetworkFeature['geometry']
}
type RenderResponse = {
  date: string
  dates?: string[]
  events?: Snapshot[]
  chronicles: Snapshot[]
  places?: MapPlace[]
  styles: RenderStyle[]
  layers: Record<'tracks' | 'routes' | 'stops' | 'areas' | 'nodes', RenderFeature[]>
  routes: Array<Omit<RouteEntity, 'segmentIds' | 'paths' | 'legs' | 'geometry'>>
}

function decodeRender(response: RenderResponse): NetworkState {
  const features: NetworkFeature[] = []
  for (const [layerName, items] of Object.entries(response.layers)) {
    const routeLayer = layerName === 'routes'
    for (const item of items) {
      const style = response.styles[item.style]!
      features.push({
        type: 'Feature',
        properties: {
          kind: item.kind ?? (layerName === 'areas' ? 'area' : layerName === 'nodes' ? 'node' : 'track'),
          mode: style.mode,
          lineId: item.id,
          number: item.number ?? '',
          name: item.name ?? '',
          color: style.color,
          trackForm: style.trackForm ?? 'single_both',
          nodeKind: item.nodeKind,
          facilityKind: item.facilityKind,
          stationId: item.stationId,
          trackId: item.trackId,
          stopGroupId: item.stopGroupId,
          stopDirection: item.stopDirection,
          platformPoint: item.platformPoint,
          layer: routeLayer ? 'route' : 'infra',
          infraId: routeLayer ? undefined : item.id,
          way: style.way,
          gauge: style.gauge,
          grade: style.grade,
          level: style.level,
          propulsion: style.propulsion,
          since: item.since,
          until: item.until,
        },
        geometry: item.geometry,
      })
    }
  }
  return {
    date: response.date,
    dates: response.dates,
    infra: [],
    routes: response.routes.map((route) => ({ ...route, segmentIds: [] })),
    chronicles: response.chronicles,
    events: response.events,
    features,
    places: response.places,
  }
}

const viewportCache = new Map<string, NetworkState>()
const VIEWPORT_CACHE_LIMIT = 6

function rememberViewport(path: string, state: NetworkState) {
  viewportCache.delete(path)
  viewportCache.set(path, state)
  while (viewportCache.size > VIEWPORT_CACHE_LIMIT) {
    const oldest = viewportCache.keys().next().value
    if (oldest == null) break
    viewportCache.delete(oldest)
  }
}

export function useViewportState(
  view: MapViewport | null,
  date?: string | null,
  workspaceId = 'main',
  enabled = true,
) {
  const [state, setState] = useState<NetworkState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !view || !date) {
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      const { west, south, east, north } = view.bounds
      const bbox = [west, south, east, north].map((value) => value.toFixed(6)).join(',')
      const path = `/api/render?bbox=${encodeURIComponent(bbox)}&date=${encodeURIComponent(date)}&zoom=${view.zoom}&workspace=${encodeURIComponent(workspaceId)}`
      try {
        const cached = viewportCache.get(path)
        const payload = cached ?? decodeRender(await api<RenderResponse>(path, { signal: controller.signal }))
        if (!cached) rememberViewport(path, payload)
        if (!cancelled) {
          setState(payload)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load map')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 160)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [date, enabled, view, workspaceId])

  return enabled ? { state, error, loading } : { state: null, error: null, loading: false }
}
