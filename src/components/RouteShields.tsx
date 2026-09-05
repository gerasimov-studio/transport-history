import L from 'leaflet'
import { useMemo } from 'react'
import { Marker } from 'react-leaflet'
import { labelsForRibbons, type RouteRibbon } from '../map/segmentLabels'
import { useMapView } from '../map/lod'

type RouteShieldsProps = {
  ribbons: RouteRibbon[]
}

export function RouteShields({ ribbons }: RouteShieldsProps) {
  const view = useMapView()
  const labels = useMemo(
    () => labelsForRibbons(ribbons, view.zoom, view.bounds),
    [ribbons, view.bounds, view.zoom],
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
