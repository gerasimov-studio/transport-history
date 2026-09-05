import L from 'leaflet'
import { CircleMarker, LayerGroup, Marker, Polyline, Popup } from 'react-leaflet'
import { alongPolyline } from './geometry'
import { strokeScale } from './lod'
import {
  gaugeLabel,
  gradeLabel,
  levelLabel,
  nodeKindLabel,
  trackFormLabel,
  validityLabel,
  type NetworkFeature,
  type NodeKind,
} from '../types'

type TrackShapeProps = {
  feature: NetworkFeature
  selected?: boolean
  showPopup?: boolean
  muted?: boolean
  emphasis?: boolean
  accent?: 'added' | 'removed' | 'changed'
  zoom?: number
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
  onSelect,
}: TrackShapeProps) {
  const events = onSelect
    ? {
        click: (event: { originalEvent: Event }) => {
          stopPropagation(event)
          onSelect()
        },
      }
    : undefined

  if (feature.geometry.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates
    const nodeKind = feature.properties.nodeKind
    const marker = (
      <CircleMarker
        center={[lat, lng]}
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
            <strong>{pointTitle(feature)}</strong>
            {feature.properties.layer === 'route' && feature.properties.number ? (
              <div>№{feature.properties.number}</div>
            ) : null}
            {feature.properties.way === 'rail' && feature.properties.gauge ? (
              <div>{gaugeLabel(feature.properties.gauge)}</div>
            ) : null}
            {feature.properties.way === 'rail' && feature.properties.grade === 'tunnel' ? (
              <div>
                {gradeLabel('tunnel')}
                {feature.properties.level != null ? ` · ${levelLabel(feature.properties.level)}` : ''}
              </div>
            ) : null}
            {feature.properties.since ? (
              <div>{validityLabel(feature.properties.since, feature.properties.until)}</div>
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
          />
      ))}
    </LayerGroup>
  )
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
}) {
  if (coordinates.length < 2) {
    return null
  }
  const isNode = feature.properties.kind === 'node'
  const isRoute = feature.properties.layer === 'route'
  const isTunnel = feature.properties.grade === 'tunnel'
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
          ? nodeKindLabel(feature.properties.nodeKind)
          : trackFormLabel(form, feature.properties.way)}
      </div>
      {feature.properties.way === 'rail' && feature.properties.gauge ? (
        <div>{gaugeLabel(feature.properties.gauge)}</div>
      ) : null}
      {isTunnel ? (
        <div>
          {gradeLabel('tunnel')}
          {feature.properties.level != null ? ` · ${levelLabel(feature.properties.level)}` : ''}
        </div>
      ) : null}
      {feature.properties.since ? <div>{validityLabel(feature.properties.since, feature.properties.until)}</div> : null}
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
          dashArray: paint.dashArray,
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
  return '#fff'
}

function pointTitle(feature: NetworkFeature): string {
  if (feature.properties.kind === 'node' && feature.properties.nodeKind) {
    return `${nodeKindLabel(feature.properties.nodeKind)} · ${feature.properties.name}`
  }
  return feature.properties.name
}
