import L from 'leaflet'
import { useState } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type { CatalogCity, NetworkFeature } from '../types'

export const NETWORK_MIN_ZOOM = 11
export const STOPS_MIN_ZOOM = 14
export const NODES_MIN_ZOOM = 15
export const LABELS_MIN_ZOOM = 12
export const CITY_RADIUS_M = 55_000

export type MapView = {
  zoom: number
  bounds: L.LatLngBounds
}

export function useMapView(): MapView {
  const map = useMap()
  const [view, setView] = useState<MapView>(() => ({
    zoom: map.getZoom(),
    bounds: map.getBounds(),
  }))
  useMapEvents({
    zoomend() {
      setView({ zoom: map.getZoom(), bounds: map.getBounds() })
    },
    moveend() {
      setView({ zoom: map.getZoom(), bounds: map.getBounds() })
    },
  })
  return view
}

export function cityInPlay(city: CatalogCity, map: L.Map): boolean {
  return map.getZoom() >= NETWORK_MIN_ZOOM && cityInReach(city, map)
}

export function cityInReach(city: CatalogCity, map: L.Map): boolean {
  const cityLatLng = L.latLng(city.center[0], city.center[1])
  const bounds = map.getBounds()
  if (bounds.pad(0.25).contains(cityLatLng)) {
    return true
  }
  const dist = map.distance(map.getCenter(), cityLatLng)
  const span = map.distance(bounds.getNorthWest(), bounds.getSouthEast()) / 2
  return dist < CITY_RADIUS_M + span
}

export function featureAtZoom(
  feature: NetworkFeature,
  zoom: number,
  reveal?: { stops?: boolean; nodes?: boolean; network?: boolean },
): boolean {
  if (zoom < NETWORK_MIN_ZOOM && !reveal?.network) {
    return false
  }
  if (feature.properties.kind === 'stop') {
    return Boolean(reveal?.stops) || zoom >= STOPS_MIN_ZOOM
  }
  if (feature.properties.kind === 'node') {
    return Boolean(reveal?.nodes) || zoom >= NODES_MIN_ZOOM
  }
  return true
}

export function featureInView(feature: NetworkFeature, bounds: L.LatLngBounds): boolean {
  const box = geometryBounds(feature.geometry)
  return box ? bounds.pad(0.45).intersects(box) : false
}

export function strokeScale(zoom: number): number {
  if (zoom <= 12) {
    return 1
  }
  if (zoom >= 19) {
    return 0.3
  }
  return 1 - ((zoom - 12) / 7) * 0.7
}

export function geometryBounds(
  geometry: NetworkFeature['geometry'],
): L.LatLngBounds | null {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates
    return L.latLngBounds([
      [lat, lng],
      [lat, lng],
    ])
  }
  const lines =
    geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : []
  const points: [number, number][] = []
  for (const line of lines) {
    for (const [lng, lat] of line) {
      points.push([lat, lng])
    }
  }
  return points.length ? L.latLngBounds(points) : null
}
