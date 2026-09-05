import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { IncomingMessage } from 'node:http'
import type pg from 'pg'
import { cookieValue } from './http.ts'

const scryptAsync = promisify(scrypt)
export const SESSION_COOKIE = 'th_session'
export const SESSION_MAX_AGE = 14 * 24 * 60 * 60

export type SessionUser = {
  id: number
  username: string
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = (await scryptAsync(password, salt, 64)) as Buffer
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) {
    return false
  }
  const expected = Buffer.from(hashHex, 'hex')
  const derived = (await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64)) as Buffer
  if (derived.length !== expected.length) {
    return false
  }
  return timingSafeEqual(derived, expected)
}

export async function createSession(pool: pg.Pool, userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3::text || ' seconds')::interval)`,
    [token, userId, String(SESSION_MAX_AGE)],
  )
  return token
}

export async function destroySession(pool: pg.Pool, token: string) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token])
}

export async function userFromRequest(pool: pg.Pool, req: IncomingMessage): Promise<SessionUser | null> {
  const token = cookieValue(req, SESSION_COOKIE)
  if (!token) {
    return null
  }
  const result = await pool.query<SessionUser>(
    `SELECT u.id, u.username
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  )
  return result.rows[0] ?? null
}
