import { useMemo } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { TrackShape } from '../map/TrackShape'
import { cityInPlay, featureAtZoom, featureInView, useMapView } from '../map/lod'
import { routeRibbons } from '../map/segmentLabels'
import type { CatalogCity, NetworkFeature } from '../types'
import { Basemap } from './Basemap'
import { RouteShields } from './RouteShields'

export type FeatureAccent = 'added' | 'removed' | 'changed'

export type ViewerFeature = NetworkFeature & {
  accent?: FeatureAccent
}

type MapStageProps = {
  city: CatalogCity
  features: ViewerFeature[]
  highlight?: boolean
}

export function MapStage({ city, features, highlight = false }: MapStageProps) {
  const renderer = useMemo(() => L.canvas({ padding: 0.55, tolerance: 12 }), [])
  return (
    <div className="map-stage">
      <MapContainer
        key={city.id}
        className="map-stage__leaflet"
        center={city.center}
        zoom={city.zoom}
        minZoom={city.minZoom}
        maxZoom={city.maxZoom}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom
        renderer={renderer}
      >
        <Basemap />
        <ViewerNetwork city={city} features={features} highlight={highlight} />
      </MapContainer>
    </div>
  )
}

function ViewerNetwork({
  city,
  features,
  highlight,
}: {
  city: CatalogCity
  features: ViewerFeature[]
  highlight: boolean
}) {
  const map = useMap()
  const view = useMapView()
  if (!cityInPlay(city, map)) {
    return null
  }
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
