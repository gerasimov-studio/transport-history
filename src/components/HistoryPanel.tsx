import { useState } from 'react'
import { formatSnapshotDate } from '../data/snapshots'
import type { Snapshot } from '../types'
import { useI18n } from '../i18n'

type HistoryPanelProps = {
  date: string | null
  snapshots: Snapshot[]
  routeLabels?: Record<string, string[]>
}

export function HistoryPanel({ date, snapshots, routeLabels = {} }: HistoryPanelProps) {
  const [open, setOpen] = useState(true)
  const { t } = useI18n()
  const primary = snapshots[0]
  const year = date?.slice(0, 4) ?? '—'

  return (
    <aside
      className={open ? 'hud-panel history-panel' : 'hud-panel history-panel is-collapsed'}
      aria-label={t('history.title')}
    >
      <button
        type="button"
        className="hud-panel__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="hud-panel__toggle-label">
          {open ? t('history.title') : year}
        </span>
        {!open ? (
          <span className="hud-panel__toggle-meta">{primary?.title ?? t('history.none')}</span>
        ) : null}
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
      </button>
      {open ? (
        <div className="history-panel__body">
          <p className="history-panel__year">{year}</p>
          {date ? <p className="history-panel__date">{formatSnapshotDate(date)}</p> : null}
          {snapshots.length === 0 ? (
            <p className="history-panel__summary">{t('history.noArticles')}</p>
          ) : (
            snapshots.map((snapshot) => (
              <article key={snapshot.id} className="history-panel__snapshot">
                <p className="history-panel__mode">{t(`mode.${snapshot.mode}`)}</p>
                <h2 className="history-panel__title">{snapshot.title}</h2>
                {routeLabels[snapshot.id]?.length ? (
                  <p className="history-panel__routes">
                    №{routeLabels[snapshot.id]?.join(' · №')}
                  </p>
                ) : null}
                <div className="history-panel__summary">{snapshot.summary}</div>
              </article>
            ))
          )}
        </div>
      ) : null}
    </aside>
  )
}
