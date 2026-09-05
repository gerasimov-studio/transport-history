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
  if (dates.length === 0) {
    return null
  }

  const min = Date.parse(dates[0] ?? date)
  const max = Date.parse(dates[dates.length - 1] ?? date)

  return (
    <div className={embedded ? 'timeline is-embedded' : 'timeline'}>
      <div className="timeline__meta">
        <span className="timeline__label">Временная шкала</span>
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
          aria-label="Дата на шкале"
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
