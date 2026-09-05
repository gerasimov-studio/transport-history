import { useState } from 'react'
import { MODE_COLORS, modeLabel, validityLabel, type RouteEntity, type TransportMode } from '../types'

type RoutesPanelProps = {
  routes: RouteEntity[]
  hidden: Set<string>
  onToggle: (id: string) => void
  onSetMode: (mode: TransportMode, visible: boolean) => void
}

export function RoutesPanel({ routes, hidden, onToggle, onSetMode }: RoutesPanelProps) {
  const [open, setOpen] = useState(true)
  const grouped = groupByMode(routes)
  const visibleCount = routes.filter((route) => !hidden.has(route.id)).length

  return (
    <section className={open ? 'hud-panel' : 'hud-panel is-collapsed'} aria-label="Маршруты">
      <button
        type="button"
        className="hud-panel__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="hud-panel__toggle-label">Маршруты</span>
        {!open ? (
          <span className="hud-panel__toggle-meta">
            {routes.length ? `${visibleCount} из ${routes.length}` : 'нет'}
          </span>
        ) : null}
        <Chevron open={open} />
      </button>
      {open ? (
        <div className="routes-panel__body">
          {grouped.length === 0 ? (
            <p className="routes-panel__empty">На эту дату маршрутов нет.</p>
          ) : (
            grouped.map((group) => {
              const allOn = group.routes.every((route) => !hidden.has(route.id))
              return (
                <div key={group.mode} className="modes-group">
                  <div className="routes-group__head">
                    <p className="modes-group__title">{modeLabel(group.mode)}</p>
                    <button
                      type="button"
                      className="routes-group__all"
                      onClick={() => onSetMode(group.mode, !allOn)}
                    >
                      {allOn ? 'Скрыть' : 'Все'}
                    </button>
                  </div>
                  <ul className="routes-list">
                    {group.routes.map((route) => {
                      const on = !hidden.has(route.id)
                      return (
                        <li key={route.id}>
                          <label className={on ? 'route-item is-on' : 'route-item'}>
                            <input type="checkbox" checked={on} onChange={() => onToggle(route.id)} />
                            <span
                              className="route-item__swatch"
                              style={{ background: route.color || MODE_COLORS[route.mode] }}
                            />
                            <span className="route-item__number">№{route.number}</span>
                            <span className="route-item__name">
                              {route.name}
                              {validityLabel(route.since, route.until)
                                ? ` · ${validityLabel(route.since, route.until)}`
                                : ''}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </section>
  )
}

function groupByMode(routes: RouteEntity[]): { mode: TransportMode; routes: RouteEntity[] }[] {
  const order: TransportMode[] = ['metro', 'tram', 'trolleybus', 'bus']
  return order
    .map((mode) => ({
      mode,
      routes: routes
        .filter((route) => route.mode === mode)
        .slice()
        .sort((left, right) => left.number.localeCompare(right.number, 'ru', { numeric: true })),
    }))
    .filter((group) => group.routes.length > 0)
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? 'hud-panel__chevron is-open' : 'hud-panel__chevron'}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="M2.5 4.5 L6 8 L9.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
