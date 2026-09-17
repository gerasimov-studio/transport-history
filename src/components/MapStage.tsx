import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { TrackShape } from '../map/TrackShape'
import { featureAtZoom, featureInView, useMapView } from '../map/lod'
import { routeRibbons } from '../map/segmentLabels'
import { MODE_COLORS, type CatalogCity, type MapPlace, type MapViewport, type NetworkFeature } from '../types'
import { Basemap } from './Basemap'
import { RouteShields } from './RouteShields'
import type { MapStart } from '../map/useVisitorLocation'

export type FeatureAccent = 'added' | 'removed' | 'changed'

export type ViewerFeature = NetworkFeature & {
  accent?: FeatureAccent
}

type MapStageProps = {
  city: CatalogCity
  features: ViewerFeature[]
  places?: MapPlace[]
  highlight?: boolean
  onViewportChange?: (view: MapViewport) => void
  start?: MapStart
}

export function MapStage({ city, features, places = [], highlight = false, onViewportChange, start }: MapStageProps) {
  const renderer = useMemo(() => L.canvas({ padding: 0.55, tolerance: 12 }), [])
  const initial = start ?? { center: city.center, zoom: city.zoom }
  return (
    <div className="map-stage">
      <MapContainer
        key={city.id}
        className="map-stage__leaflet"
        center={initial.center}
        zoom={initial.zoom}
        minZoom={2}
        maxZoom={city.maxZoom}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom
        renderer={renderer}
      >
        <Basemap />
        {start ? <StartView start={start} /> : null}
        <ViewerNetwork features={features} places={places} highlight={highlight} onViewportChange={onViewportChange} />
      </MapContainer>
    </div>
  )
}

function StartView({ start }: { start: MapStart }) {
  const map = useMap()
  const [lat, lng] = start.center
  const { zoom } = start
  useEffect(() => {
    if (start.bounds) map.fitBounds(start.bounds, { padding: [24, 24], maxZoom: 10 })
    else map.setView([lat, lng], zoom)
  }, [lat, lng, map, start.bounds, zoom])
  return null
}

function ViewerNetwork({
  features,
  places,
  highlight,
  onViewportChange,
}: {
  features: ViewerFeature[]
  places: MapPlace[]
  highlight: boolean
  onViewportChange?: (view: MapViewport) => void
}) {
  const map = useMap()
  const view = useMapView()
  useEffect(() => {
    onViewportChange?.({
      center: [view.bounds.getCenter().lat, view.bounds.getCenter().lng],
      zoom: view.zoom,
      width: map.getSize().x,
      height: map.getSize().y,
      bounds: {
        west: view.bounds.getWest(),
        south: view.bounds.getSouth(),
        east: view.bounds.getEast(),
        north: view.bounds.getNorth(),
      },
    })
  }, [map, onViewportChange, view])
  const visible = features.filter(
    (feature) => featureAtZoom(feature, view.zoom) && featureInView(feature, view.bounds),
  )
  const ribbons = routeRibbons(
    features.filter((feature) => feature.properties.layer === 'route' && feature.accent !== 'removed'),
  )
  return (
    <>
      {view.zoom < 11 ? places.map((place) => (
        <Marker
          key={place.id}
          position={place.center}
          icon={placeIcon(place, view.zoom)}
          eventHandlers={{ click: () => map.flyTo(place.center, 11) }}
        >
          <Tooltip permanent={view.zoom >= 5} direction="right" offset={[8, 0]}>{place.name}</Tooltip>
        </Marker>
      )) : null}
      {visible.map((feature, index) => (
        <TrackShape
          key={`${feature.properties.layer ?? 'feat'}-${feature.properties.lineId}-${feature.properties.infraId ?? index}-${feature.accent ?? ''}`}
          feature={feature}
          muted={
            feature.properties.layer === 'infra'
              ? feature.accent !== 'added' && feature.accent !== 'changed'
              : highlight && !feature.accent
          }
          accent={feature.accent}
          showPopup
          zoom={view.zoom}
        />
      ))}
      <RouteShields ribbons={ribbons} />
    </>
  )
}

function placeIcon(place: MapPlace, zoom: number) {
  const colors = place.modes.map((mode) => MODE_COLORS[mode])
  const size = zoom < 5 ? 12 : 16
  const step = 100 / Math.max(colors.length, 1)
  const gradient = colors.length
    ? `conic-gradient(${colors.map((color, index) => `${color} ${index * step}% ${(index + 1) * step}%`).join(',')})`
    : '#d7c4a3'
  return L.divIcon({
    className: 'system-marker-shell',
    html: `<span class="system-marker" style="width:${size}px;height:${size}px;background:${gradient}"></span>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  })
}
