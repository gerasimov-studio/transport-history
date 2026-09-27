type TimelineProps = {
  dates: string[]
  date: string
  onDateChange: (date: string) => void
  embedded?: boolean
  granularity?: 'date' | 'year' | 'system'
}

function markOffset(dates: string[], date: string) {
  if (dates.length < 2) {
    return 0
  }
  return (Math.max(0, dates.indexOf(date)) / (dates.length - 1)) * 100
}

function nearestIndex(dates: string[], date: string, granularity: 'date' | 'year' | 'system'): number {
  if (granularity === 'year' || granularity === 'system') {
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

  const systemMode = granularity === 'system'
  const years = systemMode ? [...new Set(dates.map((item) => item.slice(0, 4)))] : []
  const selectedYear = date.slice(0, 4)
  const selectedYearIndex = Math.max(0, years.indexOf(selectedYear))
  const selectedYearDates = systemMode ? dates.filter((item) => item.slice(0, 4) === selectedYear) : []
  const scaleDates = systemMode ? years.map((year) => dates.find((item) => item.startsWith(year)) ?? `${year}-01-01`) : dates
  const selectedIndex = systemMode ? selectedYearIndex : nearestIndex(dates, date, granularity)

  const selectYear = (year: string) => {
    const firstEvent = dates.find((item) => item.startsWith(year))
    if (firstEvent) onDateChange(firstEvent)
  }

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
          max={scaleDates.length - 1}
          step={1}
          value={selectedIndex}
          onChange={(event) => {
            const index = Number(event.target.value)
            if (systemMode) selectYear(years[index] ?? selectedYear)
            else onDateChange(dates[index] ?? date)
          }}
          aria-label={t('timeline')}
          aria-valuetext={granularity === 'year' ? date.slice(0, 4) : date}
        />
        <ol className="timeline__marks">
          {scaleDates.map((item, index) => (
            <li
              key={item}
              className="timeline__mark"
              style={{ left: `${markOffset(scaleDates, item)}%` }}
            >
              <button
                type="button"
                className="timeline__tick"
                aria-current={index === selectedIndex ? 'true' : undefined}
                aria-label={systemMode || granularity === 'year' ? item.slice(0, 4) : item}
                onClick={() => systemMode ? selectYear(item.slice(0, 4)) : onDateChange(item)}
              >
                <span className="timeline__dot" />
                <span className="timeline__tick-year">{item.slice(0, 4)}</span>
              </button>
            </li>
          ))}
        </ol>
        {systemMode && selectedYearDates.length > 1 ? (
          <ol className="timeline__events" aria-label={`${t('timeline')} ${selectedYear}`}>
            {selectedYearDates.slice(1).map((item, index) => (
              <li
                key={item}
                className="timeline__event-mark"
                style={{
                  left: `calc(${markOffset(scaleDates, scaleDates[selectedYearIndex] ?? scaleDates[0]!)}% + ${(index + 1) * 18}px)`,
                }}
              >
                <button
                  type="button"
                  className="timeline__event-tick"
                  aria-current={item === date ? 'true' : undefined}
                  aria-label={item}
                  title={item}
                  onClick={() => onDateChange(item)}
                />
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  )
}
import { useI18n } from '../i18n'
