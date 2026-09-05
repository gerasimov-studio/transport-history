export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const response = await fetch(path, { ...init, headers })
  const body = (await response.json().catch(() => null)) as T & { error?: string }
  if (!response.ok) {
    throw new Error(body?.error ?? `${path} ${response.status}`)
  }
  return body
}
