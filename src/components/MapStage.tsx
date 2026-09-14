import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { TrackShape } from '../map/TrackShape'
import { featureAtZoom, featureInView, useMapView } from '../map/lod'
import { routeRibbons } from '../map/segmentLabels'
import type { CatalogCity, MapPlace, MapViewport, NetworkFeature } from '../types'
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
    map.setView([lat, lng], zoom)
  }, [lat, lng, map, zoom])
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
        <CircleMarker
          key={place.id}
          center={place.center}
          radius={view.zoom < 5 ? 5 : 7}
          pathOptions={{ color: '#1c1814', weight: 2, fillColor: '#d7c4a3', fillOpacity: 0.95 }}
          eventHandlers={{ click: () => map.flyTo(place.center, 11) }}
        >
          <Tooltip permanent={view.zoom >= 5} direction="right" offset={[8, 0]}>{place.name}</Tooltip>
        </CircleMarker>
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
