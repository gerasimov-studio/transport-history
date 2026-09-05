import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type pg from 'pg'
import { hashPassword } from './auth.ts'

export async function migrateAndSeed(pool: pg.Pool, seedDir: string) {
  const schema = readFileSync(join(seedDir, '../init.sql'), 'utf8')
  await pool.query(schema)

  await pool.query(
    `INSERT INTO cities (id, name, aliases, lat, lng, zoom, min_zoom, max_zoom)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       aliases = EXCLUDED.aliases,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       zoom = EXCLUDED.zoom,
       min_zoom = EXCLUDED.min_zoom,
       max_zoom = EXCLUDED.max_zoom`,
    ['spb', 'Петербург', ['Санкт-Петербург', 'Петербург', 'Петроград', 'Ленинград'], 59.9386, 30.3141, 12, 8, 20],
  )

  const codes: [string, string][] = [
    ['ТМ', 'tram'],
    ['МТ', 'metro'],
    ['ТБ', 'trolleybus'],
    ['АВ', 'bus'],
  ]
  for (const [code, mode] of codes) {
    await pool.query(
      `INSERT INTO mode_codes (code, mode) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET mode = EXCLUDED.mode`,
      [code, mode],
    )
  }

  const existingUsers = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM users')
  if ((existingUsers.rows[0]?.n ?? 0) === 0) {
    const username = process.env.EDITOR_USERNAME ?? 'editor'
    const password = process.env.EDITOR_PASSWORD ?? 'editor'
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [
      username,
      await hashPassword(password),
    ])
  }
}
