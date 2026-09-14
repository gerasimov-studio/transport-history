import L from 'leaflet'
import { useMemo } from 'react'
import { Marker, useMap } from 'react-leaflet'
import { labelsForRibbons, type RouteRibbon } from '../map/segmentLabels'
import { useMapView } from '../map/lod'

type RouteShieldsProps = {
  ribbons: RouteRibbon[]
}

export function RouteShields({ ribbons }: RouteShieldsProps) {
  const map = useMap()
  const view = useMapView()
  const labels = useMemo(
    () => declutterLabels(labelsForRibbons(ribbons, view.zoom, view.bounds), map, view.zoom),
    [map, ribbons, view.bounds, view.zoom],
  )

  if (labels.length === 0) {
    return null
  }

  return (
    <>
      {labels.map((label) => (
        <Marker
          key={label.key}
          position={[label.point[1], label.point[0]]}
          interactive={false}
          zIndexOffset={400}
          icon={shieldIcon(label, view.zoom)}
        />
      ))}
    </>
  )
}

function declutterLabels(
  labels: ReturnType<typeof labelsForRibbons>,
  map: L.Map,
  zoom: number,
) {
  const minDistance = zoom < 14 ? 280 : zoom < 16 ? 240 : 200
  const accepted: { label: (typeof labels)[number]; point: L.Point }[] = []

  for (const label of labels.slice().sort((left, right) => right.priority - left.priority)) {
    const point = map.latLngToContainerPoint([label.point[1], label.point[0]])
    if (accepted.some((item) => item.point.distanceTo(point) < minDistance)) {
      continue
    }
    accepted.push({ label, point })
  }

  return accepted.map(({ label }) => label)
}

function shieldIcon(label: { text: string; color: string; angle: number }, zoom: number): L.DivIcon {
  const compact = zoom < 14
  return L.divIcon({
    className: 'route-shield-marker',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<span class="route-shield${compact ? ' is-compact' : ''}" style="transform:translate(-50%,-120%) rotate(${label.angle}deg);border-color:${label.color}">${escapeHtml(label.text)}</span>`,
  })
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
