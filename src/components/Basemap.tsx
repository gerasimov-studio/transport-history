import { AttributionControl, TileLayer, ZoomControl } from 'react-leaflet'

type BasemapProps = {
  zoomPosition?: 'bottomleft' | 'topleft'
}

export function Basemap({ zoomPosition = 'bottomleft' }: BasemapProps) {
  return (
    <>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={20}
        maxNativeZoom={19}
        detectRetina
      />
      <ZoomControl position={zoomPosition} />
      <AttributionControl position="bottomleft" prefix={false} />
    </>
  )
}
