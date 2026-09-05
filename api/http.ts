import type { IncomingMessage, ServerResponse } from 'node:http'

export function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAge: number) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  const previous = res.getHeader('Set-Cookie')
  const cookies = Array.isArray(previous) ? previous : previous ? [String(previous)] : []
  res.setHeader('Set-Cookie', [...cookies, parts.join('; ')])
}

export function clearCookie(res: ServerResponse, name: string) {
  setCookie(res, name, '', 0)
}

export function cookieValue(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie
  if (!header) {
    return null
  }
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=')
    if (rawKey === name) {
      return rest.join('=') || null
    }
  }
  return null
}

export function readBody(req: IncomingMessage, limit = 2_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req)
  if (!raw) {
    return {} as T
  }
  return JSON.parse(raw) as T
}
