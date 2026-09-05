import L from 'leaflet'
import { useMemo } from 'react'
import { MapContainer, Marker, useMap, useMapEvents } from 'react-leaflet'
import { collectSnapGraph, snapDrawPoint, type SnapGraph } from '../../map/snap'
import { TrackShape } from '../../map/TrackShape'
import { cityInReach, featureAtZoom, featureInView, useMapView } from '../../map/lod'
import { routeRibbons } from '../../map/segmentLabels'
import { infraAliveAt, periodsOverlap, sameGauge, type CatalogCity, type NetworkFeature, type TrackGrade } from '../../types'
import { Basemap } from '../Basemap'
import { RouteShields } from '../RouteShields'

export type DrawTool = 'select' | 'track' | 'stop' | 'node'

export type DraftFeature = NetworkFeature & { key: string }

type EditorMapProps = {
  city: CatalogCity
  features: DraftFeature[]
  selectedKey: string | null
  tool: DrawTool
  enableVertices?: boolean
  muteInfra?: boolean
  lockTurns?: boolean
  snapWay?: string
  activeGauge?: number
  activeGrade?: TrackGrade | 'portal'
  activeLevel?: number
  activeDate?: string
  routePeriod?: { since?: string; until?: string }
  previousPoint?: [number, number]
  onSelect: (feature: DraftFeature) => void
  onMapClick: (lng: number, lat: number) => void
  onMoveVertex: (key: string, index: number, coord: [number, number]) => void
  onMovePoint: (key: string, coord: [number, number]) => void
}

const vertexIcon = new L.DivIcon({
  className: 'editor-vertex',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const vertexIconActive = new L.DivIcon({
  className: 'editor-vertex is-active',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

export function EditorMap({
  city,
  features,
  selectedKey,
  tool,
  enableVertices = true,
  muteInfra = false,
  lockTurns = false,
  snapWay = 'rail',
  activeGauge,
  activeGrade,
  activeLevel,
  activeDate,
  routePeriod,
  previousPoint,
  onSelect,
  onMapClick,
  onMoveVertex,
  onMovePoint,
}: EditorMapProps) {
  const renderer = useMemo(() => L.canvas({ padding: 0.55, tolerance: 12 }), [])
  const snapGraph = collectSnapGraph(features, {
    way: snapWay,
    gauge: activeGauge,
    grade: activeGrade,
    level: activeLevel,
  })

  return (
    <div className={tool === 'select' ? 'map-stage' : 'map-stage is-drawing'}>
      <MapContainer
        key={city.id}
        className="map-stage__leaflet"
        center={city.center}
        zoom={13}
        minZoom={8}
        maxZoom={20}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom
        renderer={renderer}
      >
        <Basemap />
        <ClickCatch
          tool={tool}
          lockTurns={lockTurns}
          snapGraph={snapGraph}
          previousPoint={previousPoint}
          onMapClick={onMapClick}
        />
        <EditorNetwork
          city={city}
          features={features}
          selectedKey={selectedKey}
          tool={tool}
          enableVertices={enableVertices}
          muteInfra={muteInfra}
          lockTurns={lockTurns}
          snapWay={snapWay}
          activeGauge={activeGauge}
          activeGrade={activeGrade}
          activeLevel={activeLevel}
          activeDate={activeDate}
          routePeriod={routePeriod}
          onSelect={onSelect}
          onMoveVertex={onMoveVertex}
          onMovePoint={onMovePoint}
        />
      </MapContainer>
    </div>
  )
}

function EditorNetwork({
  city,
  features,
  selectedKey,
  tool,
  enableVertices,
  muteInfra,
  lockTurns,
  snapWay,
  activeGauge,
  activeGrade,
  activeLevel,
  activeDate,
  routePeriod,
  onSelect,
  onMoveVertex,
  onMovePoint,
}: {
  city: CatalogCity
  features: DraftFeature[]
  selectedKey: string | null
  tool: DrawTool
  enableVertices: boolean
  muteInfra: boolean
  lockTurns: boolean
  snapWay: string
  activeGauge?: number
  activeGrade?: TrackGrade | 'portal'
  activeLevel?: number
  activeDate?: string
  routePeriod?: { since?: string; until?: string }
  onSelect: (feature: DraftFeature) => void
  onMoveVertex: (key: string, index: number, coord: [number, number]) => void
  onMovePoint: (key: string, coord: [number, number]) => void
}) {
  const map = useMap()
  const view = useMapView()
  if (!cityInReach(city, map)) {
    return null
  }
  const visible = features.filter((feature) => {
    const selected =
      feature.properties.layer === 'route'
        ? feature.properties.lineId === selectedKey
        : feature.key === selectedKey
    return (
      selected ||
      (featureAtZoom(feature, view.zoom, {
        network: true,
        stops: tool === 'stop',
        nodes: tool === 'node',
      }) &&
        featureInView(feature, view.bounds))
    )
  })
  const ribbons = muteInfra
    ? routeRibbons(features.filter((feature) => feature.properties.layer === 'route'))
    : []
  return (
    <>
      {visible.map((feature) => {
        const selected =
          feature.properties.layer === 'route'
            ? feature.properties.lineId === selectedKey
            : feature.key === selectedKey
        const routable = isRoutableTrack(feature, {
          way: snapWay,
          gauge: activeGauge,
          date: activeDate,
          period: routePeriod,
        })
        const muted = muteInfra
          ? feature.properties.layer === 'infra' && !routable
          : (activeGauge != null &&
              feature.properties.layer === 'infra' &&
              feature.properties.gauge != null &&
              !sameGauge(feature.properties.gauge, activeGauge)) ||
            (activeGrade != null &&
              feature.properties.layer === 'infra' &&
              alignmentMuted(feature, activeGrade, activeLevel)) ||
            (Boolean(activeDate) &&
              feature.properties.layer === 'infra' &&
              !infraAliveAt(feature.properties, activeDate ?? ''))
        return (
        <DraftShape
          key={feature.key}
          feature={feature}
          selected={selected}
          enableVertices={enableVertices}
          zoom={view.zoom}
          muted={muted}
          emphasis={
            feature.properties.layer === 'infra' &&
            feature.properties.kind === 'track' &&
            (!muteInfra || routable) &&
            !muted
          }
          lockTurns={lockTurns}
          snapWay={snapWay}
          activeGauge={activeGauge}
          activeGrade={activeGrade}
          activeLevel={activeLevel}
          features={features}
          onSelect={() => onSelect(feature)}
          onMoveVertex={(index, coord) => onMoveVertex(feature.key, index, coord)}
          onMovePoint={(coord) => onMovePoint(feature.key, coord)}
        />
        )
      })}
      <RouteShields ribbons={ribbons} />
    </>
  )
}

function ClickCatch({
  tool,
  lockTurns,
  snapGraph,
  previousPoint,
  onMapClick,
}: {
  tool: DrawTool
  lockTurns: boolean
  snapGraph: SnapGraph
  previousPoint?: [number, number]
  onMapClick: (lng: number, lat: number) => void
}) {
  const map = useMapEvents({
    click(event) {
      if (tool === 'select') {
        return
      }
      const snapped = snapDrawPoint(map, [event.latlng.lng, event.latlng.lat], snapGraph, {
        lockTurns,
        from: previousPoint,
      })
      onMapClick(snapped[0], snapped[1])
    },
  })
  return null
}

function DraftShape({
  feature,
  selected,
  enableVertices,
  muted,
  emphasis,
  zoom,
  lockTurns,
  snapWay,
  activeGauge,
  activeGrade,
  activeLevel,
  features,
  onSelect,
  onMoveVertex,
  onMovePoint,
}: {
  feature: DraftFeature
  selected: boolean
  enableVertices: boolean
  muted: boolean
  emphasis: boolean
  zoom: number
  lockTurns: boolean
  snapWay: string
  activeGauge?: number
  activeGrade?: TrackGrade | 'portal'
  activeLevel?: number
  features: DraftFeature[]
  onSelect: () => void
  onMoveVertex: (index: number, coord: [number, number]) => void
  onMovePoint: (coord: [number, number]) => void
}) {
  const map = useMap()
  const line =
    enableVertices && selected && feature.geometry.type === 'LineString'
      ? feature.geometry.coordinates
      : null
  const point =
    enableVertices && selected && feature.geometry.type === 'Point'
      ? feature.geometry.coordinates
      : null

  return (
    <>
      {!(selected && point) ? (
        <TrackShape
          feature={feature}
          selected={selected}
          muted={muted}
          emphasis={emphasis}
          zoom={zoom}
          onSelect={onSelect}
        />
      ) : null}
      {line
        ? line.map(([lng, lat], index) => (
            <Marker
              key={`${feature.key}-${index}`}
              position={[lat, lng]}
              draggable
              icon={vertexIconActive}
              eventHandlers={{
                click: (event) => {
                  L.DomEvent.stopPropagation(event.originalEvent)
                  onSelect()
                },
                dragend: (event) => {
                  const next = event.target.getLatLng()
                  const graph = collectSnapGraph(
                    features,
                    { way: snapWay, gauge: activeGauge, grade: activeGrade, level: activeLevel },
                    {
                    key: feature.key,
                    index,
                  },
                  )
                  const from = line[index - 1] ?? line[index + 1]
                  const snapped = snapDrawPoint(map, [next.lng, next.lat], graph, { lockTurns, from })
                  onMoveVertex(index, snapped)
                },
              }}
            />
          ))
        : null}
      {point ? (
        <Marker
          position={[point[1], point[0]]}
          draggable
          icon={vertexIcon}
          eventHandlers={{
            click: (event) => {
              L.DomEvent.stopPropagation(event.originalEvent)
              onSelect()
            },
            dragend: (event) => {
              const next = event.target.getLatLng()
              const snapped = snapDrawPoint(
                map,
                [next.lng, next.lat],
                collectSnapGraph(features, {
                  way: snapWay,
                  gauge: activeGauge,
                  grade: activeGrade,
                  level: activeLevel,
                }),
                { lockTurns: false },
              )
              onMovePoint(snapped)
            },
          }}
        />
      ) : null}
    </>
  )
}

function isRoutableTrack(
  feature: DraftFeature,
  match: {
    way: string
    gauge?: number
    date?: string
    period?: { since?: string; until?: string }
  },
): boolean {
  if (feature.properties.layer !== 'infra' || feature.properties.kind !== 'track') {
    return false
  }
  if (feature.properties.way && feature.properties.way !== match.way) {
    return false
  }
  if (match.date && !infraAliveAt(feature.properties, match.date)) {
    return false
  }
  if (match.period && !periodsOverlap(feature.properties, match.period)) {
    return false
  }
  if (match.gauge != null && feature.properties.gauge != null && !sameGauge(feature.properties.gauge, match.gauge)) {
    return false
  }
  return true
}

function alignmentMuted(
  feature: DraftFeature,
  activeGrade: TrackGrade | 'portal',
  activeLevel?: number,
): boolean {
  if (feature.properties.nodeKind === 'portal' || activeGrade === 'portal') {
    return false
  }
  const grade = feature.properties.grade ?? 'surface'
  if (grade !== activeGrade) {
    return true
  }
  if (grade === 'tunnel' && activeLevel != null && (feature.properties.level ?? -1) !== activeLevel) {
    return true
  }
  return false
}
