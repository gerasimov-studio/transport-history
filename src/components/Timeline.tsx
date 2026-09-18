type TimelineProps = {
  dates: string[]
  date: string
  onDateChange: (date: string) => void
  embedded?: boolean
}

function markOffset(dates: string[], date: string) {
  if (dates.length < 2) {
    return 0
  }
  return (Math.max(0, dates.indexOf(date)) / (dates.length - 1)) * 100
}

function nearestIndex(dates: string[], date: string): number {
  return dates.reduce((best, item, index) =>
    Math.abs(Date.parse(item) - Date.parse(date)) < Math.abs(Date.parse(dates[best]!) - Date.parse(date))
      ? index
      : best,
  0)
}

export function Timeline({ dates, date, onDateChange, embedded = false }: TimelineProps) {
  const { t } = useI18n()
  if (dates.length === 0) {
    return null
  }

  const selectedIndex = nearestIndex(dates, date)
  const labelledDates = visibleYearLabels(dates)

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
          min={0}
          max={dates.length - 1}
          step={1}
          value={selectedIndex}
          onChange={(event) => onDateChange(dates[Number(event.target.value)] ?? date)}
          aria-label={t('timeline')}
          aria-valuetext={date}
        />
        <ol className="timeline__marks">
          {dates.map((item, index) => (
            <li
              key={item}
              className="timeline__mark"
              style={{ left: `${markOffset(dates, item)}%` }}
            >
              <button
                type="button"
                className="timeline__tick"
                aria-current={index === selectedIndex ? 'true' : undefined}
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

function visibleYearLabels(dates: string[]): Set<string> {
  const byYear = new Map<string, string>()
  for (const item of dates) {
    const year = item.slice(0, 4)
    if (!byYear.has(year)) byYear.set(year, item)
  }
  const unique = [...byYear.values()]
  const priority = [unique[0], unique.at(-1), ...unique].filter(
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
