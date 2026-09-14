type TimelineProps = {
  dates: string[]
  date: string
  onDateChange: (date: string) => void
  embedded?: boolean
}

function markOffset(dates: string[], date: string) {
  const min = Date.parse(dates[0] ?? date)
  const max = Date.parse(dates[dates.length - 1] ?? date)
  if (max === min) {
    return 0
  }
  return ((Date.parse(date) - min) / (max - min)) * 100
}

function nearestDate(dates: string[], timestamp: number): string {
  return dates.reduce((best, item) =>
    Math.abs(Date.parse(item) - timestamp) < Math.abs(Date.parse(best) - timestamp)
      ? item
      : best,
  )
}

export function Timeline({ dates, date, onDateChange, embedded = false }: TimelineProps) {
  const { t } = useI18n()
  if (dates.length === 0) {
    return null
  }

  const min = Date.parse(dates[0] ?? date)
  const max = Date.parse(dates[dates.length - 1] ?? date)
  const labelledDates = visibleYearLabels(dates, date)

  return (
    <div className={embedded ? 'timeline is-embedded' : 'timeline'}>
      <div className="timeline__meta">
        <span className="timeline__label">{t('timeline')}</span>
        <span className="timeline__current" aria-live="polite">
          {date.slice(0, 4)}
        </span>
      </div>
      <div className="timeline__track">
        <input
          className="timeline__slider"
          type="range"
          min={min}
          max={max}
          value={Date.parse(date)}
          onChange={(event) => onDateChange(nearestDate(dates, Number(event.target.value)))}
          aria-label={t('timeline')}
          aria-valuetext={date}
        />
        <ol className="timeline__marks">
          {dates.map((item) => (
            <li
              key={item}
              className="timeline__mark"
              style={{ left: `${markOffset(dates, item)}%` }}
            >
              <button
                type="button"
                className="timeline__tick"
                aria-current={item === date ? 'true' : undefined}
                aria-label={item}
                onClick={() => onDateChange(item)}
              >
                <span className="timeline__dot" />
                {labelledDates.has(item) ? <span className="timeline__tick-year">{item.slice(0, 4)}</span> : null}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function visibleYearLabels(dates: string[], selected: string): Set<string> {
  const byYear = new Map<string, string>()
  for (const item of dates) {
    const year = item.slice(0, 4)
    if (!byYear.has(year) || item === selected) byYear.set(year, item)
  }
  const unique = [...byYear.values()]
  const priority = [selected, unique[0], unique.at(-1), ...unique].filter(
    (item): item is string => Boolean(item),
  )
  const labelled = new Set<string>()
  const offsets: number[] = []
  for (const item of priority) {
    if (labelled.has(item)) continue
    const offset = markOffset(dates, item)
    if (offsets.some((accepted) => Math.abs(accepted - offset) < 4.5)) continue
    labelled.add(item)
    offsets.push(offset)
  }
  return labelled
}
import { useI18n } from '../i18n'
