import { useEffect, useState } from 'react'

export type MapStart = {
  center: [number, number]
  zoom: number
}

const WORLD_VIEW: MapStart = { center: [20, 0], zoom: 2 }

export function useVisitorLocation() {
  const [start, setStart] = useState<MapStart>(WORLD_VIEW)

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setStart({ center: [coords.latitude, coords.longitude], zoom: 11 }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 },
    )
  }, [])

  return start
}
