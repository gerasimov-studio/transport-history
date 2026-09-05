import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export type EditorUser = {
  username: string
}

export function useSession() {
  const [user, setUser] = useState<EditorUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api<{ user: EditorUser }>('/api/me')
      .then((body) => {
        if (!cancelled) {
          setUser(body.user)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { user, loading, setUser }
}
