import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { NetworkState } from '../types'

export function useNetworkState(city?: string, date?: string | null) {
  const [state, setState] = useState<NetworkState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!city || !date) {
      setState(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const cityId = city
    const onDate = date
    setLoading(true)

    async function load() {
      try {
        const payload = await api<NetworkState>(
          `/api/state?city=${encodeURIComponent(cityId)}&date=${encodeURIComponent(onDate)}`,
        )
        if (!cancelled) {
          setState(payload)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сеть')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [city, date])

  return { state, error, loading }
}
