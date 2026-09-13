import { useEffect, useMemo } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { TrackShape } from '../map/TrackShape'
import { featureAtZoom, featureInView, useMapView } from '../map/lod'
import { routeRibbons } from '../map/segmentLabels'
import type { CatalogCity, MapViewport, NetworkFeature } from '../types'
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
  highlight?: boolean
  onViewportChange?: (view: MapViewport) => void
  start?: MapStart
}

export function MapStage({ city, features, highlight = false, onViewportChange, start }: MapStageProps) {
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
        <ViewerNetwork features={features} highlight={highlight} onViewportChange={onViewportChange} />
      </MapContainer>
    </div>
  )
}

function StartView({ start }: { start: MapStart }) {
  const map = useMap()
  useEffect(() => {
    map.setView(start.center, start.zoom)
  }, [map, start])
  return null
}

function ViewerNetwork({
  features,
  highlight,
  onViewportChange,
}: {
  features: ViewerFeature[]
  highlight: boolean
  onViewportChange?: (view: MapViewport) => void
}) {
  useMap()
  const view = useMapView()
  useEffect(() => {
    onViewportChange?.({
      zoom: view.zoom,
      bounds: {
        west: view.bounds.getWest(),
        south: view.bounds.getSouth(),
        east: view.bounds.getEast(),
        north: view.bounds.getNorth(),
      },
    })
  }, [onViewportChange, view])
  const visible = features.filter(
    (feature) => featureAtZoom(feature, view.zoom) && featureInView(feature, view.bounds),
  )
  const ribbons = routeRibbons(
    features.filter((feature) => feature.properties.layer === 'route' && feature.accent !== 'removed'),
  )
  return (
    <>
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
