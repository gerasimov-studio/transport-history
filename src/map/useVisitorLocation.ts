import { useEffect, useState } from 'react'

export type MapStart = {
  center: [number, number]
  zoom: number
  bounds?: [[number, number], [number, number]]
}

const WORLD_VIEW: MapStart = { center: [20, 0], zoom: 2 }
const STORAGE_KEY = 'transport-history:last-view'

function storedView(): MapStart | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<MapStart> | null
    if (!value || !Array.isArray(value.center) || value.center.length !== 2 || !Number.isFinite(value.zoom)) return null
    const [lat, lng] = value.center
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat! < -90 || lat! > 90 || lng! < -180 || lng! > 180) return null
    return { center: [lat!, lng!], zoom: Math.max(2, Math.min(22, value.zoom!)) }
  } catch { return null }
}

export function rememberMapView(view: MapStart) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ center: view.center, zoom: view.zoom })) } catch { /* storage is optional */ }
}

export function useVisitorLocation() {
  const [start, setStart] = useState<MapStart>(() => storedView() ?? WORLD_VIEW)

  useEffect(() => {
    if (storedView()) return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const center: [number, number] = [coords.latitude, coords.longitude]
        try {
          const response = await fetch(`/api/location-context?lat=${encodeURIComponent(coords.latitude)}&lng=${encodeURIComponent(coords.longitude)}`)
          if (response.ok) {
            const context = await response.json() as { bounds?: [[number, number], [number, number]] }
            const next = { center, zoom: 6, bounds: context.bounds }
            setStart(next)
            return
          }
        } catch { /* point fallback below */ }
        setStart({ center, zoom: 8 })
      },
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 },
    )
  }, [])

  return start
}
