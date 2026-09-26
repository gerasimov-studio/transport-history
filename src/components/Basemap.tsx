import { AttributionControl, TileLayer } from 'react-leaflet'

export function Basemap() {
  return (
    <>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={22}
        maxNativeZoom={19}
        detectRetina
      />
      <AttributionControl position="bottomleft" prefix={false} />
    </>
  )
}
