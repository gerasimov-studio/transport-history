import { useState } from 'react'
import {
  TRANSPORT_WAYS,
  modesForWay,
  type TransportMode,
} from '../types'
import { useI18n } from '../i18n'

type ModesPanelProps = {
  modes: Record<TransportMode, boolean>
  onToggle: (mode: TransportMode) => void
}

export function ModesPanel({ modes, onToggle }: ModesPanelProps) {
  const [open, setOpen] = useState(true)
  const { t } = useI18n()
  const enabled = (Object.keys(modes) as TransportMode[])
    .filter((mode) => modes[mode])
    .map((mode) => t(`mode.${mode}`))

  return (
    <section className={open ? 'hud-panel' : 'hud-panel is-collapsed'} aria-label={t('modes.title')}>
      <button
        type="button"
        className="hud-panel__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="hud-panel__toggle-label">{t('modes.title')}</span>
        {!open ? (
          <span className="hud-panel__toggle-meta">{enabled.join(' · ') || t('modes.hidden')}</span>
        ) : null}
        <Chevron open={open} />
      </button>
      {open ? (
        <div className="modes-panel__body">
          {TRANSPORT_WAYS.map((way) => (
            <div key={way.id} className="modes-group">
              <p className="modes-group__title">{t(`way.${way.id}`)}</p>
              <ul className="modes-list">
                {modesForWay(way.id).map((mode) => (
                  <li key={mode}>
                    <label className={modes[mode] ? 'mode is-on' : 'mode'}>
                      <input
                        type="checkbox"
                        checked={modes[mode]}
                        onChange={() => onToggle(mode)}
                      />
                      <span>{t(`mode.${mode}`)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
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
