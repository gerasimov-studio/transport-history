import { useCallback, useEffect, useState } from 'react'
import type { Catalog, NetworkCollection } from '../types'

export function useCatalog(options?: { loadNetworks?: boolean }) {
  const loadNetworks = options?.loadNetworks !== false
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [networks, setNetworks] = useState<Record<string, NetworkCollection>>({})
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch('/api/catalog')
        if (!response.ok) {
          throw new Error(`catalog ${response.status}`)
        }
        const parsed = (await response.json()) as Catalog
        const nextCatalog: Catalog = {
          ...parsed,
          lines: parsed.lines ?? [],
          dates: parsed.dates ?? [],
          snapshots: parsed.snapshots ?? [],
        }
        const entries = loadNetworks
          ? await Promise.all(
              nextCatalog.snapshots.map(async (snapshot) => {
                const networkResponse = await fetch(snapshot.network)
                if (!networkResponse.ok) {
                  throw new Error(`${snapshot.network} ${networkResponse.status}`)
                }
                const collection = (await networkResponse.json()) as NetworkCollection
                return [snapshot.network, collection] as const
              }),
            )
          : []
        if (!cancelled) {
          setCatalog(nextCatalog)
          setNetworks(Object.fromEntries(entries))
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить каталог')
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [loadNetworks, tick])

  return { catalog, networks, error, reload }
}
