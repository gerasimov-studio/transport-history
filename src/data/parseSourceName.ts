import type { Catalog, ParsedSourceName, TransportMode } from '../types'

const SOURCE_NAME =
  /^(.+)_([A-ZА-ЯЁ]{2})_(\d{4})_(\d{2})_(\d{2})\.(?:gif|png|jpe?g)$/i

export function parseSourceName(filename: string): ParsedSourceName | null {
  const base = filename.split(/[/\\]/).pop() ?? filename
  const match = base.match(SOURCE_NAME)
  if (!match) {
    return null
  }

  const [, cityAlias, modeCode, year, month, day] = match
  if (!cityAlias || !modeCode || !year || !month || !day) {
    return null
  }

  return {
    cityAlias,
    modeCode: modeCode.toUpperCase(),
    date: `${year}-${month}-${day}`,
  }
}

export function resolveSourceName(
  filename: string,
  catalog: Pick<Catalog, 'cities' | 'modeCodes'>,
): { cityId: string; mode: TransportMode; date: string } | null {
  const parsed = parseSourceName(filename)
  if (!parsed) {
    return null
  }

  const alias = parsed.cityAlias.toLowerCase()
  const city = catalog.cities.find(
    (item) =>
      item.id === alias ||
      item.name.toLowerCase() === alias ||
      item.aliases.some((name) => name.toLowerCase() === alias),
  )
  const mode = catalog.modeCodes[parsed.modeCode]
  if (!city || !mode) {
    return null
  }

  return { cityId: city.id, mode, date: parsed.date }
}
