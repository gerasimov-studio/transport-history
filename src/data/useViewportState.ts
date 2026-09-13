import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { MapViewport, NetworkState } from '../types'

export function useViewportState(view: MapViewport | null, date?: string | null, workspaceId = 'main') {
  const [state, setState] = useState<NetworkState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!view || !date) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      const { west, south, east, north } = view.bounds
      const bbox = [west, south, east, north].map((value) => value.toFixed(6)).join(',')
      try {
        const payload = await api<NetworkState>(
          `/api/map?bbox=${encodeURIComponent(bbox)}&date=${encodeURIComponent(date)}&zoom=${view.zoom}&workspace=${encodeURIComponent(workspaceId)}`,
        )
        if (!cancelled) {
          setState(payload)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить карту')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [date, view, workspaceId])

  return { state, error, loading }
}
