type YearRangeSliderProps = {
  minYear: number
  maxYear: number
  start: string
  end: string
  onStart: (value: string) => void
  onEnd: (value: string) => void
}

function yearOf(value: string, fallback: number): number {
  const year = Number(value.slice(0, 4))
  return Number.isFinite(year) ? year : fallback
}

function keepDay(current: string, year: number, bound: 'start' | 'end'): string {
  if (current.startsWith(`${year}-`) && /^\d{4}-\d{2}-\d{2}$/.test(current)) {
    return current
  }
  return bound === 'start' ? `${year}-01-01` : `${year}-12-31`
}

export function YearRangeSlider({ minYear, maxYear, start, end, onStart, onEnd }: YearRangeSliderProps) {
  const openYear = maxYear + 1
  const startYear = Math.min(maxYear, Math.max(minYear, yearOf(start, minYear)))
  const endYear = end ? Math.min(maxYear, Math.max(startYear, yearOf(end, maxYear))) : openYear
  const span = Math.max(1, openYear - minYear)
  const left = ((startYear - minYear) / span) * 100
  const right = ((endYear - minYear) / span) * 100

  return (
    <div className="year-range">
      <div className="year-range__meta">
        <span>{startYear}</span>
        <span>{end ? endYear : 'н.в.'}</span>
      </div>
      <div className="year-range__track">
        <div className="year-range__rail" />
        <div className="year-range__fill" style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} />
        <input
          className="year-range__input year-range__input--start"
          type="range"
          min={minYear}
          max={end ? endYear : maxYear}
          value={startYear}
          aria-label="Год начала"
          onChange={(event) => {
            const next = Math.min(Number(event.target.value), end ? endYear : maxYear)
            onStart(keepDay(start, next, 'start'))
          }}
        />
        <input
          className="year-range__input year-range__input--end"
          type="range"
          min={minYear}
          max={openYear}
          value={endYear}
          aria-label="Год окончания"
          onChange={(event) => {
            const raw = Number(event.target.value)
            if (raw >= openYear) {
              onEnd('')
              return
            }
            const next = Math.max(raw, startYear)
            onEnd(keepDay(end, next, 'end'))
          }}
        />
      </div>
      <div className="year-range__scale">
        <span>{minYear}</span>
        <span>н.в.</span>
      </div>
    </div>
  )
}
