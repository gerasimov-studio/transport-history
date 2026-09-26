type TimelineProps = {
  dates: string[]
  date: string
  onDateChange: (date: string) => void
  embedded?: boolean
  granularity?: 'date' | 'year'
}

function markOffset(dates: string[], date: string) {
  if (dates.length < 2) {
    return 0
  }
  return (Math.max(0, dates.indexOf(date)) / (dates.length - 1)) * 100
}

function nearestIndex(dates: string[], date: string, granularity: 'date' | 'year'): number {
  if (granularity === 'year') {
    const sameYear = dates.findIndex((item) => item.slice(0, 4) === date.slice(0, 4))
    if (sameYear >= 0) return sameYear
  }
  return dates.reduce((best, item, index) =>
    Math.abs(Date.parse(item) - Date.parse(date)) < Math.abs(Date.parse(dates[best]!) - Date.parse(date))
      ? index
      : best,
  0)
}

export function Timeline({ dates, date, onDateChange, embedded = false, granularity = 'date' }: TimelineProps) {
  const { t } = useI18n()
  if (dates.length === 0) {
    return null
  }

  const selectedIndex = nearestIndex(dates, date, granularity)

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
          aria-valuetext={granularity === 'year' ? date.slice(0, 4) : date}
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
                aria-label={granularity === 'year' ? item.slice(0, 4) : item}
                onClick={() => onDateChange(item)}
              >
                <span className="timeline__dot" />
                <span className="timeline__tick-year">{item.slice(0, 4)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
import { useI18n } from '../i18n'
