import L from 'leaflet'
import { CircleMarker, LayerGroup, Marker, Polygon, Polyline, Popup, useMap } from 'react-leaflet'
import { alongPolyline, DOUBLE_TRACK_DETAIL_ZOOM, doubleTrackVisibleGap, offsetPolyline, singleTrackJoins } from './geometry'
import { STOP_DIRECTION_DETAIL_ZOOM, strokeScale } from './lod'
import { type NetworkFeature, type NodeKind } from '../types'
import { useI18n, type Locale } from '../i18n'
import { domain } from '../domainI18n'

type TrackShapeProps = {
  feature: NetworkFeature
  selected?: boolean
  showPopup?: boolean
  muted?: boolean
  emphasis?: boolean
  accent?: 'added' | 'removed' | 'changed'
  zoom?: number
  networkFeatures?: NetworkFeature[]
  onSelect?: () => void
}

function stopPropagation(event: { originalEvent: Event }) {
  L.DomEvent.stopPropagation(event.originalEvent)
}

export function TrackShape({
  feature,
  selected = false,
  showPopup = false,
  muted = false,
  emphasis = false,
  accent,
  zoom = 13,
  networkFeatures = [],
  onSelect,
}: TrackShapeProps) {
  const { locale } = useI18n()
  const map = useMap()
  const events = onSelect
    ? {
        click: (event: { originalEvent: Event }) => {
          stopPropagation(event)
          onSelect()
        },
      }
    : undefined

  if (feature.geometry.type === 'Polygon') {
    return (
      <Polygon
        positions={feature.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number]))}
        pathOptions={{ color: feature.properties.color, weight: selected ? 3 : 2, fillOpacity: muted ? 0.12 : 0.24 }}
        eventHandlers={events}
      >
        {showPopup ? <Popup><strong>{feature.properties.name}</strong></Popup> : null}
      </Polygon>
    )
  }

  if (feature.geometry.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates
    const nodeKind = feature.properties.nodeKind
    const stopAngle = feature.properties.kind === 'stop'
      ? linkedTrackAngle(map, feature, networkFeatures)
      : undefined
    const center = [lat, lng] as [number, number]
    if (
      feature.properties.kind === 'stop' &&
      stopAngle != null &&
      feature.properties.stopDirection &&
      feature.properties.stopDirection !== 'both' &&
      zoom >= STOP_DIRECTION_DETAIL_ZOOM
    ) {
      const side = feature.properties.stopDirection === 'forward' ? 1 : -1
      const icon = stopSemicircleIcon(feature.properties.color, stopAngle, side, selected)
      return (
        <Marker position={center} icon={icon} eventHandlers={events}>
          {showPopup ? <Popup><strong>{pointTitle(feature, locale)}</strong></Popup> : null}
        </Marker>
      )
    }
    const marker = (
      <CircleMarker
        center={center}
        radius={pointRadius(feature.properties.kind, nodeKind, selected)}
        pathOptions={{
          color: accent === 'removed' ? '#8f4d45' : nodeKind === 'portal' ? '#d7c4a3' : accent ? '#d7c4a3' : '#1a1a1a',
          weight: accent ? 2.5 : nodeKind === 'portal' ? 2 : 1.5,
          fillColor: pointFill(feature.properties.kind, nodeKind, feature.properties.color),
          fillOpacity: muted && !accent ? 0.7 : 1,
        }}
        eventHandlers={events}
      >
        {showPopup ? (
          <Popup>
            <strong>{pointTitle(feature, locale)}</strong>
            {feature.properties.layer === 'route' && feature.properties.number ? (
              <div>№{feature.properties.number}</div>
            ) : null}
            {feature.properties.way === 'rail' && feature.properties.gauge ? (
              <div>{domain.gauge(locale, feature.properties.gauge)}</div>
            ) : null}
            {feature.properties.way === 'rail' && feature.properties.grade === 'tunnel' ? (
              <div>
                {domain.grade(locale, 'tunnel')}
                {feature.properties.level != null ? ` · ${domain.level(locale, feature.properties.level)}` : ''}
              </div>
            ) : null}
            {feature.properties.since ? (
              <div>{domain.validity(locale, feature.properties.since, feature.properties.until)}</div>
            ) : null}
          </Popup>
        ) : null}
      </CircleMarker>
    )
    return marker
  }

  const lines =
    feature.geometry.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature.geometry.type === 'MultiLineString'
        ? feature.geometry.coordinates
        : []

  return (
    <LayerGroup>
      {lines.map((line, index) => (
          <TrackLine
            key={index}
            feature={feature}
            coordinates={line}
            selected={selected}
            muted={muted}
            emphasis={emphasis}
            accent={accent}
            showPopup={showPopup}
            zoom={zoom}
            events={events}
            locale={locale}
            networkFeatures={networkFeatures}
          />
      ))}
    </LayerGroup>
  )
}

function linkedTrackAngle(map: L.Map, stop: NetworkFeature, features: NetworkFeature[]) {
  const track = features.find((candidate) =>
    candidate.properties.layer === 'infra' &&
    candidate.properties.kind === 'track' &&
    candidate.properties.infraId === stop.properties.trackId,
  )
  if (!track || stop.geometry.type !== 'Point') return undefined
  const lines = track.geometry.type === 'LineString'
    ? [track.geometry.coordinates]
    : track.geometry.type === 'MultiLineString' ? track.geometry.coordinates : []
  const actual = map.latLngToLayerPoint([stop.geometry.coordinates[1], stop.geometry.coordinates[0]])
  let best: { angle: number; distance: number } | undefined
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const start = map.latLngToLayerPoint([line[index - 1][1], line[index - 1][0]])
      const end = map.latLngToLayerPoint([line[index][1], line[index][0]])
      const vector = end.subtract(start)
      const lengthSquared = vector.x * vector.x + vector.y * vector.y
      if (!lengthSquared) continue
      const relative = actual.subtract(start)
      const t = Math.max(0, Math.min(1, (relative.x * vector.x + relative.y * vector.y) / lengthSquared))
      const point = L.point(start.x + vector.x * t, start.y + vector.y * t)
      const distance = actual.distanceTo(point)
      if (!best || distance < best.distance) {
        best = { angle: Math.atan2(vector.y, vector.x) * 180 / Math.PI, distance }
      }
    }
  }
  return best?.angle
}

function stopSemicircleIcon(color: string, angle: number, side: number, selected: boolean) {
  const width = selected ? 16 : 13
  const height = width / 2
  const rotation = angle + (side > 0 ? 180 : 0)
  const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#277a64'
  return L.divIcon({
    className: 'stop-platform-marker-shell',
    html: `<span class="stop-platform-marker" style="width:${width}px;height:${height}px;border-color:#1a1a1a;background:${safeColor};transform:rotate(${rotation}deg)"></span>`,
    iconSize: [width, width],
    iconAnchor: [width / 2, width / 2],
  })
}

function TrackLine({
  feature,
  coordinates,
  selected,
  muted,
  emphasis,
  accent,
  showPopup,
  zoom,
  events,
  locale,
  networkFeatures,
}: {
  feature: NetworkFeature
  coordinates: [number, number][]
  selected: boolean
  muted: boolean
  emphasis: boolean
  accent?: 'added' | 'removed' | 'changed'
  showPopup: boolean
  zoom: number
  events?: { click: (event: { originalEvent: Event }) => void }
  locale: Locale
  networkFeatures: NetworkFeature[]
}) {
  if (coordinates.length < 2) {
    return null
  }
  const isNode = feature.properties.kind === 'node'
  const isRoute = feature.properties.layer === 'route'
  const isTunnel = feature.properties.grade === 'tunnel'
  const isAutonomous = feature.properties.propulsion === 'autonomous'
  const form = feature.properties.trackForm
  const paint = linePaint(feature.properties.color, form, muted, selected, isTunnel, accent, zoom, emphasis)
  const positions = coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
  const casing =
    emphasis && !muted && !accent ? (
      <Polyline
        positions={positions}
        interactive={false}
        pathOptions={{
          color: '#f4efe6',
          weight: paint.weight + 3.2 * strokeScale(zoom),
          opacity: 0.88,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    ) : null
  const popup = showPopup ? (
    <Popup>
      <strong>
        {isRoute && feature.properties.number
          ? `№${feature.properties.number}${feature.properties.name ? ` · ${feature.properties.name}` : ''}`
          : feature.properties.name}
      </strong>
      <div>
        {isNode && feature.properties.nodeKind
          ? domain.node(locale, feature.properties.nodeKind)
          : isAutonomous
            ? domain.propulsion(locale, 'autonomous')
            : domain.trackForm(locale, form, feature.properties.way, feature.properties.mode)}
      </div>
      {feature.properties.way === 'rail' && feature.properties.gauge ? (
        <div>{domain.gauge(locale, feature.properties.gauge)}</div>
      ) : null}
      {isTunnel ? (
        <div>
          {domain.grade(locale, 'tunnel')}
          {feature.properties.level != null ? ` · ${domain.level(locale, feature.properties.level)}` : ''}
        </div>
      ) : null}
      {feature.properties.since ? <div>{domain.validity(locale, feature.properties.since, feature.properties.until)}</div> : null}
    </Popup>
  ) : null

  if (isNode) {
    return (
      <>
        {casing}
        <Polyline
          positions={positions}
          pathOptions={{
            color: paint.color,
            weight: paint.weight,
            opacity: paint.opacity,
            dashArray: paint.dashArray ?? '3 8',
            lineCap: 'round',
            lineJoin: 'round',
          }}
          eventHandlers={events}
        >
          {popup}
        </Polyline>
      </>
    )
  }

  if (form === 'double') {
    if (zoom >= DOUBLE_TRACK_DETAIL_ZOOM) {
      const trackWeight = Math.max(1.35, (selected ? 2.8 : 2.1) * strokeScale(zoom))
      const visibleGap = doubleTrackVisibleGap(feature.properties.mode, zoom, selected)
      const separation = (trackWeight + visibleGap) / 2
      const joins = singleTrackJoins(feature, coordinates, networkFeatures)
      const trackLines = [-separation, separation].map((offset) =>
        offsetPolyline(coordinates, offset, zoom, joins).map(([lng, lat]) => [lat, lng] as [number, number]),
      )
      return (
        <>
          {casing}
          {trackLines.map((trackPositions, index) => (
            <Polyline
              key={index}
              positions={trackPositions}
              pathOptions={{
                color: paint.color,
                weight: trackWeight,
                opacity: paint.opacity,
                dashArray: paint.dashArray ?? (isTunnel ? '10 8' : undefined),
                lineCap: 'round',
                lineJoin: 'round',
              }}
              eventHandlers={events}
            >
              {index === 0 ? popup : null}
            </Polyline>
          ))}
        </>
      )
    }
    return (
      <>
        {casing}
        <Polyline
          positions={positions}
          pathOptions={{
            color: paint.color,
            weight: paint.weight,
            opacity: paint.opacity,
            dashArray: paint.dashArray ?? (isTunnel ? '10 8' : undefined),
            lineCap: 'round',
            lineJoin: 'round',
          }}
          eventHandlers={events}
        >
          {popup}
        </Polyline>
        <Polyline
          positions={positions}
          pathOptions={{
            color: paint.core,
            weight: Math.max(1, (selected ? 3 : muted ? 1.5 : 2) * strokeScale(zoom)),
            opacity: muted && !accent ? 0.35 : 0.9,
            dashArray: paint.dashArray ?? (isTunnel ? '10 8' : undefined),
            lineCap: 'round',
            lineJoin: 'round',
          }}
          eventHandlers={events}
        />
      </>
    )
  }

  return (
    <>
      {casing}
      <Polyline
        positions={positions}
        pathOptions={{
          color: paint.color,
          weight: paint.weight,
          opacity: paint.opacity,
          dashArray: isAutonomous ? '18 10' : paint.dashArray,
          lineCap: 'round',
          lineJoin: 'round',
        }}
        eventHandlers={events}
      >
        {popup}
      </Polyline>
      {form === 'single_oneway' && !muted && accent !== 'removed' && zoom >= 14
        ? [0.35, 0.7].map((fraction) => {
            const sample = alongPolyline(coordinates, fraction)
            if (!sample) {
              return null
            }
            return (
              <Marker
                key={fraction}
                position={[sample.point[1], sample.point[0]]}
                interactive={false}
                icon={arrowIcon(paint.color, sample.bearing)}
              />
            )
          })
        : null}
    </>
  )
}

function linePaint(
  color: string,
  form: string,
  muted: boolean,
  selected: boolean,
  isTunnel: boolean,
  accent: 'added' | 'removed' | 'changed' | undefined,
  zoom: number,
  emphasis: boolean,
): { color: string; core: string; weight: number; opacity: number; dashArray?: string } {
  const scale = strokeScale(zoom)
  const baseWeight = Math.max(
    1.15,
    (selected
      ? form === 'double'
        ? 9
        : 6
      : form === 'double'
        ? muted
          ? 5
          : emphasis
            ? 8
            : 7
        : form === 'single_oneway'
          ? emphasis
            ? 4.5
            : 3.5
          : muted
            ? 3
            : emphasis
              ? 5.5
              : 4) * scale,
  )
  if (accent === 'removed') {
    return {
      color: '#8f4d45',
      core: '#3a2220',
      weight: baseWeight,
      opacity: 0.72,
      dashArray: '6 7',
    }
  }
  if (accent === 'added') {
    return {
      color: '#e8d7b4',
      core: '#12171c',
      weight: baseWeight + 1.5,
      opacity: 1,
      dashArray: isTunnel ? '10 8' : undefined,
    }
  }
  if (accent === 'changed') {
    return {
      color: '#d7c4a3',
      core: '#12171c',
      weight: baseWeight + 1,
      opacity: 0.96,
      dashArray: isTunnel ? '10 8' : form === 'single_oneway' ? '12 8' : form === 'single_both' ? '10 5 2 5' : undefined,
    }
  }
  return {
    color: emphasis && !muted ? lighten(color) : color,
    core: '#12171c',
    weight: baseWeight,
    opacity: muted ? (form === 'double' ? 0.45 : 0.5) : isTunnel ? 0.88 : 1,
    dashArray: isTunnel
      ? form === 'double'
        ? '10 8'
        : '8 7'
      : form === 'single_oneway'
        ? '12 8'
        : form === 'single_both'
          ? '10 5 2 5'
          : undefined,
  }
}

function lighten(color: string): string {
  if (!color.startsWith('#') || (color.length !== 7 && color.length !== 4)) {
    return '#e4dfd6'
  }
  const hex = color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color
  const value = Number.parseInt(hex.slice(1), 16)
  const mix = (channel: number) => Math.min(255, Math.round(channel + (255 - channel) * 0.38))
  const r = mix((value >> 16) & 255)
  const g = mix((value >> 8) & 255)
  const b = mix(value & 255)
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function arrowIcon(color: string, bearing: number) {
  return L.divIcon({
    className: 'track-arrow',
    iconSize: [12, 12],
    iconAnchor: [3, 6],
                html: `<span style="border-left-color:${color};transform:rotate(${bearing - 90}deg)"></span>`,
  })
}

function pointRadius(kind: string, nodeKind: NodeKind | undefined, selected: boolean): number {
  if (kind === 'node') {
    if (nodeKind === 'portal') {
      return selected ? 9 : 8
    }
    return selected ? 8 : nodeKind === 'terminus' ? 7 : 6
  }
  if (kind === 'station') return selected ? 8 : 6
  if (kind === 'entrance') return selected ? 5 : 3
  return selected ? 6 : 4
}

function pointFill(kind: string, nodeKind: NodeKind | undefined, color: string): string {
  if (kind === 'node') {
    if (nodeKind === 'portal') {
      return '#1c2228'
    }
    if (nodeKind === 'terminus') {
      return color
    }
    return '#f3eee6'
  }
  if (kind === 'station') return color
  if (kind === 'entrance') return '#f3eee6'
  return '#fff'
}

function pointTitle(feature: NetworkFeature, locale: Locale): string {
  if (feature.properties.kind === 'node' && feature.properties.nodeKind) {
    return `${domain.node(locale, feature.properties.nodeKind)} · ${feature.properties.name}`
  }
  if (feature.properties.kind === 'station') {
    return `${locale === 'ru' ? 'Станция' : locale === 'sr' ? 'Stanica' : 'Station'} · ${feature.properties.name}`
  }
  if (feature.properties.kind === 'entrance') {
    return `${locale === 'ru' ? 'Вход' : locale === 'sr' ? 'Ulaz' : 'Entrance'} · ${feature.properties.name}`
  }
  return feature.properties.name
}
