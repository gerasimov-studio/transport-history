import {
  GAUGE_PRESETS,
  TRACK_GRADES,
  TRANSPORT_WAYS,
  TUNNEL_LEVELS,
  canonicalGauge,
  infraAliveAt,
  infraGauge,
  infraGrade,
  infraLevel,
  infraWay,
  modesForWay,
  nodeKindsForWay,
  trackFormsForWay,
  type CatalogLine,
  type EditorLayer,
  type InfraEntity,
  type NodeKind,
  type RouteEntity,
  type TrackForm,
  type TrackGrade,
  type TransportMode,
  type TransportWay,
} from '../../types'
import { Timeline } from '../Timeline'
import { YearRangeSlider } from '../YearRangeSlider'
import type { DrawTool } from './EditorMap'
import { useI18n, type Locale } from '../../i18n'
import { domain } from '../../domainI18n'

export type DraftNetwork = {
  city: string
  way: TransportWay
  mode: TransportMode
  date: string
  title: string
  summary: string
  layer: EditorLayer
  infra: InfraEntity[]
  routes: RouteEntity[]
}

type InfraPatch = {
  name?: string
  color?: string
  trackForm?: TrackForm
  nodeKind?: NodeKind
  gauge?: number
  grade?: TrackGrade
  level?: number
  since?: string
  until?: string
}

type RoutePatch = {
  number?: string
  name?: string
  color?: string
  since?: string
  until?: string
}

type StudioPanelProps = {
  username: string
  dates: string[]
  lines: CatalogLine[]
  draft: DraftNetwork
  selectedInfraId: string | null
  selectedRouteId: string | null
  tool: DrawTool
  routeLegType: 'wire' | 'autonomous'
  drawNumber: string
  trackForm: TrackForm
  nodeKind: NodeKind
  drawGauge: number
  drawGrade: TrackGrade
  drawLevel: number
  drawSince: string
  drawUntil: string
  lockTurns: boolean
  dirty: boolean
  commitSummary: { metadataChanged: number; upsertInfra: number; removeInfra: number; upsertRoutes: number; removeRoutes: number; total: number }
  hasCommit: boolean
  saving: boolean
  message: string | null
  onTool: (tool: DrawTool) => void
  onRouteLegType: (value: 'wire' | 'autonomous') => void
  onDrawNumber: (value: string) => void
  onTrackForm: (value: TrackForm) => void
  onNodeKind: (value: NodeKind) => void
  onDrawGauge: (value: number) => void
  onDrawGrade: (value: TrackGrade) => void
  onDrawLevel: (value: number) => void
  onDrawSince: (value: string) => void
  onDrawUntil: (value: string) => void
  onLockTurns: (value: boolean) => void
  onSelectDate: (date: string) => void
  onNewDate: () => void
  onChange: (patch: Partial<DraftNetwork>) => void
  onSelectInfra: (id: string) => void
  onChangeInfra: (id: string, patch: InfraPatch) => void
  onDeleteInfra: () => void
  onUndoVertex: () => void
  onReverse: () => void
  onSelectRoute: (id: string) => void
  onChangeRoute: (id: string, patch: RoutePatch) => void
  onAddRoute: () => void
  onDeleteRoute: () => void
  onMoveSegment: (id: string, direction: -1 | 1) => void
  onRemoveSegment: (id: string) => void
  onSave: () => void
  onDiscard: () => void
  canSubmit: boolean
  onSubmit: () => void
  onLogout: () => void
}

export function StudioPanel({
  username,
  dates,
  lines,
  draft,
  selectedInfraId,
  selectedRouteId,
  tool,
  routeLegType,
  drawNumber,
  trackForm,
  nodeKind,
  drawGauge,
  drawGrade,
  drawLevel,
  drawSince,
  drawUntil,
  lockTurns,
  dirty,
  commitSummary,
  hasCommit,
  saving,
  message,
  onTool,
  onRouteLegType,
  onDrawNumber,
  onTrackForm,
  onNodeKind,
  onDrawGauge,
  onDrawGrade,
  onDrawLevel,
  onDrawSince,
  onDrawUntil,
  onLockTurns,
  onSelectDate,
  onNewDate,
  onChange,
  onSelectInfra,
  onChangeInfra,
  onDeleteInfra,
  onUndoVertex,
  onReverse,
  onSelectRoute,
  onChangeRoute,
  onAddRoute,
  onDeleteRoute,
  onMoveSegment,
  onRemoveSegment,
  onSave,
  onDiscard,
  canSubmit,
  onSubmit,
  onLogout,
}: StudioPanelProps) {
  const { locale, t } = useI18n()
  const infra = draft.infra.filter((entity) => infraWay(entity) === draft.way)
  const routes = draft.routes.filter((entity) => entity.mode === draft.mode)
  const selectedInfra = infra.find((entity) => entity.id === selectedInfraId)
  const selectedRoute = routes.find((entity) => entity.id === selectedRouteId)
  const familyModes = modesForWay(draft.way)
  const knownNumbers = [
    ...new Set([
      ...lines.filter((line) => line.city === draft.city && line.mode === draft.mode).map((line) => line.number),
      ...routes.map((route) => route.number),
    ]),
  ]
  const selectedSegments = selectedRoute
    ? (selectedRoute.legs?.flatMap((leg) => leg.type === 'wire' ? leg.segmentIds : []) ?? selectedRoute.segmentIds)
        .map((id) => infra.find((entity) => entity.id === id))
        .filter((entity): entity is InfraEntity => Boolean(entity))
    : []
  const trackForms = trackFormsForWay(draft.way)
  const nodeKinds = nodeKindsForWay(draft.way)
  const currentGauge = canonicalGauge(selectedInfra ? infraGauge(selectedInfra) ?? drawGauge : drawGauge)
  const currentGrade = selectedInfra && selectedInfra.nodeKind !== 'portal' ? infraGrade(selectedInfra) : drawGrade
  const currentLevel = selectedInfra && selectedInfra.nodeKind !== 'portal' ? infraLevel(selectedInfra) : drawLevel
  const currentSince =
    draft.layer === 'route' ? selectedRoute?.since ?? drawSince : selectedInfra?.since ?? drawSince
  const currentUntil =
    draft.layer === 'route'
      ? selectedRoute
        ? (selectedRoute.until ?? '')
        : drawUntil
      : selectedInfra
        ? (selectedInfra.until ?? '')
        : drawUntil

  function applyGauge(raw: number) {
    const value = canonicalGauge(raw)
    onDrawGauge(value)
    if (selectedInfra) {
      onChangeInfra(selectedInfra.id, { gauge: value })
    }
  }

  function applyGrade(value: TrackGrade) {
    onDrawGrade(value)
    if (selectedInfra && selectedInfra.nodeKind !== 'portal') {
      onChangeInfra(selectedInfra.id, { grade: value, level: value === 'tunnel' ? currentLevel || -1 : undefined })
    }
  }

  function applyLevel(value: number) {
    onDrawLevel(value)
    if (selectedInfra && selectedInfra.nodeKind !== 'portal') {
      onChangeInfra(selectedInfra.id, { level: value })
    }
  }

  return (
    <aside className="studio-rail">
      <header className="studio-rail__head">
        <div>
          <p className="studio-rail__kicker">{t('login.studio')}</p>
          <p className="studio-rail__user">{username}</p>
        </div>
        <div className="studio-tools">
          <a className="studio-btn studio-btn--ghost" href="/account">{t('studio.mySpace')}</a>
          <button type="button" className="studio-btn studio-btn--ghost" onClick={onLogout}>{t('studio.logout')}</button>
        </div>
      </header>

      <section className="studio-section">
        <div className="studio-section__title-row">
          <h2>{t('studio.dates')}</h2>
          <button type="button" className="studio-btn" onClick={onNewDate}>
            {t('studio.new')}
          </button>
        </div>
        <Timeline dates={dates} date={draft.date} onDateChange={onSelectDate} embedded />
      </section>

      <section className="studio-section">
        <h2>{t('studio.article')}</h2>
        <label className="studio-field">
          {t('studio.date')}
          <input
            type="date"
            value={draft.date}
            onChange={(event) => onChange({ date: event.target.value })}
          />
        </label>
        <label className="studio-field">
          {t('studio.mode')}
          <select
            value={draft.mode}
            onChange={(event) => onChange({ mode: event.target.value as TransportMode })}
          >
            {familyModes.map((mode) => (
              <option key={mode} value={mode}>
                {domain.mode(locale, mode)}
              </option>
            ))}
          </select>
        </label>
        <label className="studio-field">
          {t('studio.heading')}
          <input value={draft.title} onChange={(event) => onChange({ title: event.target.value })} />
        </label>
        <label className="studio-field">
          {t('studio.text')}
          <textarea
            rows={6}
            value={draft.summary}
            onChange={(event) => onChange({ summary: event.target.value })}
          />
        </label>
      </section>

      <section className="studio-section">
        <h2>{t('studio.network')}</h2>
        <div className="studio-tabs">
          {TRANSPORT_WAYS.map((way) => (
            <button
              key={way.id}
              type="button"
              className={draft.way === way.id ? 'studio-btn is-on' : 'studio-btn'}
              onClick={() => onChange({ way: way.id })}
            >
              {domain.way(locale, way.id)}
            </button>
          ))}
        </div>
        <div className="studio-tabs">
          <button
            type="button"
            className={draft.layer === 'infra' ? 'studio-btn is-on' : 'studio-btn'}
            onClick={() => onChange({ layer: 'infra' })}
          >
            {t('studio.infrastructure')}
          </button>
          <button
            type="button"
            className={draft.layer === 'route' ? 'studio-btn is-on' : 'studio-btn'}
            onClick={() => onChange({ layer: 'route' })}
          >
            {t('studio.routes')}
          </button>
        </div>
        <div className="studio-fields-row">
          <label className="studio-field">
            {t('studio.activeFrom')}
            <input type="date" value={currentSince} onChange={(event) => onDrawSince(event.target.value)} />
          </label>
          <label className="studio-field">
            {currentUntil ? t('studio.activeUntil') : `${t('studio.activeUntil')} · ${t('studio.present')}`}
            <span className="studio-until">
              <input
                type="date"
                value={currentUntil}
                min={currentSince}
                onChange={(event) => onDrawUntil(event.target.value)}
              />
              {currentUntil ? (
                <button type="button" className="studio-btn" onClick={() => onDrawUntil('')}>
                  {t('studio.present')}
                </button>
              ) : null}
            </span>
          </label>
        </div>
        <YearRangeSlider
          minYear={1830}
          maxYear={new Date().getFullYear()}
          start={currentSince}
          end={currentUntil}
          onStart={onDrawSince}
          onEnd={onDrawUntil}
        />
        <p className="studio-hint">
          {currentUntil
            ? t('studio.periodClosedHint')
            : t('studio.periodOpenHint')}
        </p>

        {draft.layer === 'infra' ? (
          <>
            <div className="studio-tools">
              <button
                type="button"
                className={tool === 'select' ? 'studio-btn is-on' : 'studio-btn'}
                onClick={() => onTool('select')}
              >
                {t('studio.select')}
              </button>
              <button
                type="button"
                className={tool === 'track' ? 'studio-btn is-on' : 'studio-btn'}
                onClick={() => onTool('track')}
              >
                {draft.way === 'road' ? t('studio.street') : t('studio.track')}
              </button>
              <button
                type="button"
                className={tool === 'stop' ? 'studio-btn is-on' : 'studio-btn'}
                onClick={() => onTool('stop')}
              >
                {t('studio.stop')}
              </button>
              <button
                type="button"
                className={tool === 'node' ? 'studio-btn is-on' : 'studio-btn'}
                onClick={() => onTool('node')}
              >
                {t('studio.node')}
              </button>
            </div>
            {tool === 'track' || selectedInfra?.kind === 'track' ? (
              <label className="studio-field">
                {draft.way === 'road' ? t('studio.streetType') : t('studio.trackType')}
                <select
                  value={selectedInfra?.kind === 'track' ? selectedInfra.trackForm : trackForm}
                  onChange={(event) => {
                    const value = event.target.value as TrackForm
                    onTrackForm(value)
                    if (selectedInfra?.kind === 'track') {
                      onChangeInfra(selectedInfra.id, { trackForm: value })
                    }
                  }}
                >
                  {trackForms.map((item) => (
                    <option key={item.id} value={item.id}>
                      {domain.trackForm(locale, item.id, draft.way)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {tool === 'node' || selectedInfra?.kind === 'node' ? (
              <label className="studio-field">
                {t('studio.nodeElement')}
                <select
                  value={selectedInfra?.nodeKind ?? nodeKind}
                  onChange={(event) => {
                    const value = event.target.value as NodeKind
                    onNodeKind(value)
                    if (selectedInfra?.kind === 'node') {
                      onChangeInfra(selectedInfra.id, { nodeKind: value })
                    }
                  }}
                >
                  {nodeKinds.map((item) => (
                    <option key={item.id} value={item.id}>
                      {domain.node(locale, item.id)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {draft.way === 'rail' ? (
              <>
                <div className="studio-tabs">
                  {TRACK_GRADES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={currentGrade === item.id ? 'studio-btn is-on' : 'studio-btn'}
                      onClick={() => applyGrade(item.id)}
                    >
                      {domain.grade(locale, item.id)}
                    </button>
                  ))}
                </div>
                {currentGrade === 'tunnel' ? (
                  <label className="studio-field">
                    {t('studio.level')}
                    <select value={String(currentLevel)} onChange={(event) => applyLevel(Number(event.target.value))}>
                      {TUNNEL_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {domain.level(locale, level)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="studio-field">
                  {t('studio.gauge')}
                  <select
                    value={
                      GAUGE_PRESETS.some((item) => item.mm === currentGauge) ? String(currentGauge) : 'custom'
                    }
                    onChange={(event) => {
                      if (event.target.value === 'custom') {
                        return
                      }
                      applyGauge(Number(event.target.value))
                    }}
                  >
                    {GAUGE_PRESETS.map((item) => (
                      <option key={item.mm} value={item.mm}>
                        {domain.gauge(locale, item.mm)}
                      </option>
                    ))}
                    <option value="custom">{t('studio.customGauge')}</option>
                  </select>
                </label>
                <label className="studio-field">
                  {t('studio.widthMm')}
                  <input
                    type="number"
                    min={600}
                    max={3000}
                    value={currentGauge}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (!Number.isFinite(value)) {
                        return
                      }
                      applyGauge(value)
                    }}
                  />
                </label>
              </>
            ) : null}
            <label className="studio-check">
              <input
                type="checkbox"
                checked={lockTurns}
                onChange={(event) => onLockTurns(event.target.checked)}
              />
              {t('studio.lockTurns')}
            </label>
            <p className="studio-hint">
              {tool === 'track'
                ? draft.way === 'road'
                  ? t('studio.hintRoad')
                  : currentGrade === 'tunnel'
                    ? t('studio.hintTunnel')
                    : t('studio.hintRail')
                : tool === 'stop'
                  ? t('studio.hintStop')
                  : tool === 'node'
                    ? t('studio.hintNode')
                    : t('studio.hintSelect')}{' '}
              {t('studio.hintClose')}
            </p>
            {draft.mode === 'trolleybus' && selectedRoute ? (
              <div className="studio-tools" role="group" aria-label={t('studio.propulsion')}>
                <button type="button" className={`studio-btn${routeLegType === 'wire' ? ' studio-btn--primary' : ''}`} onClick={() => onRouteLegType('wire')}>
                  {t('studio.underWire')}
                </button>
                <button type="button" className={`studio-btn${routeLegType === 'autonomous' ? ' studio-btn--primary' : ''}`} onClick={() => onRouteLegType('autonomous')}>
                  {t('studio.autonomous')}
                </button>
              </div>
            ) : null}
            <ul className="studio-list studio-list--features">
              {infra.map((entity) => (
                <li key={entity.id}>
                  <button
                    type="button"
                    className={[
                      'studio-list__item',
                      entity.id === selectedInfraId ? 'is-current' : '',
                      infraAliveAt(entity, draft.date) ? '' : 'is-muted',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSelectInfra(entity.id)}
                  >
                    <span>{infraKindLabel(entity, locale, { stop: t('studio.stop'), street: t('studio.street'), track: t('studio.track'), portal: t('studio.portal') })}</span>
                    <strong>{entity.name}</strong>
                  </button>
                </li>
              ))}
            </ul>
            {selectedInfra ? (
              <div className="studio-feature">
                <label className="studio-field">
                  {t('studio.name')}
                  <input
                    value={selectedInfra.name}
                    onChange={(event) => onChangeInfra(selectedInfra.id, { name: event.target.value })}
                  />
                </label>
                <label className="studio-field">
                  {t('studio.color')}
                  <input
                    type="color"
                    value={selectedInfra.color}
                    onChange={(event) => onChangeInfra(selectedInfra.id, { color: event.target.value })}
                  />
                </label>
                {selectedInfra.kind === 'track' ? (
                  <p className="studio-hint">{domain.trackForm(locale, selectedInfra.trackForm, draft.way)}</p>
                ) : null}
                <div className="studio-tools">
                  {selectedInfra.geometry.type === 'LineString' ? (
                    <button type="button" className="studio-btn" onClick={onUndoVertex}>
                      {t('studio.undoPoint')}
                    </button>
                  ) : null}
                  {selectedInfra.trackForm === 'single_oneway' &&
                  selectedInfra.geometry.type === 'LineString' ? (
                    <button type="button" className="studio-btn" onClick={onReverse}>
                      {t('studio.reverse')}
                    </button>
                  ) : null}
                  <button type="button" className="studio-btn studio-btn--danger" onClick={onDeleteInfra}>
                    {t('studio.deleteObject')}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <label className="studio-field">
              {t('studio.number')}
              <input
                list="line-numbers"
                value={selectedRoute ? selectedRoute.number : drawNumber}
                onChange={(event) => {
                  const value = event.target.value
                  if (selectedRoute) {
                    onChangeRoute(selectedRoute.id, { number: value })
                  }
                  onDrawNumber(value)
                }}
              />
              <datalist id="line-numbers">
                {knownNumbers.map((number) => (
                  <option key={number} value={number} />
                ))}
              </datalist>
            </label>
            <div className="studio-tools">
              <button type="button" className="studio-btn studio-btn--primary" onClick={onAddRoute}>
                {t('studio.addRoute')}
              </button>
            </div>
            <p className="studio-hint">
              {draft.mode === 'bus' ? t('studio.hintRoadRoute') : t('studio.hintRoute')} {t('studio.hintClose')}
            </p>
            <ul className="studio-list studio-list--features">
              {routes.map((route) => {
                const period = domain.validity(locale, route.since, route.until)
                const muted = !infraAliveAt(route, draft.date)
                return (
                  <li key={route.id}>
                    <button
                      type="button"
                      className={[
                        'studio-list__item',
                        route.id === selectedRouteId ? 'is-current' : '',
                        muted ? 'is-muted' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => onSelectRoute(route.id)}
                    >
                      <span>№{route.number}{period ? ` · ${period}` : ''}</span>
                      <strong>{route.name}</strong>
                    </button>
                  </li>
                )
              })}
            </ul>
            {selectedRoute ? (
              <div className="studio-feature">
                <label className="studio-field">
                  {t('studio.name')}
                  <input
                    value={selectedRoute.name}
                    onChange={(event) => onChangeRoute(selectedRoute.id, { name: event.target.value })}
                  />
                </label>
                <label className="studio-field">
                  {t('studio.color')}
                  <input
                    type="color"
                    value={selectedRoute.color}
                    onChange={(event) => onChangeRoute(selectedRoute.id, { color: event.target.value })}
                  />
                </label>
                <p className="studio-hint">
                  {draft.mode === 'bus'
                    ? `${t('studio.points')}: ${selectedRoute.geometry?.coordinates.length || t('studio.noneYet')}`
                    : `${t('studio.segments')}: ${selectedSegments.length || t('studio.noneYet')}`}
                </p>
                {draft.mode === 'bus' && selectedRoute.geometry?.coordinates.length ? (
                  <div className="studio-tools">
                    <button type="button" className="studio-btn" onClick={onUndoVertex}>{t('studio.undoPoint')}</button>
                    <button type="button" className="studio-btn" onClick={onReverse}>{t('studio.reverse')}</button>
                  </div>
                ) : null}
                <ul className="studio-list studio-list--features">
                  {selectedSegments.map((segment) => (
                    <li key={segment.id}>
                      <div className="studio-list__item studio-list__item--static">
                        <span>
                          {domain.trackForm(locale, segment.trackForm, draft.way)}
                          {domain.validity(locale, segment.since, segment.until)
                            ? ` · ${domain.validity(locale, segment.since, segment.until)}`
                            : ''}
                        </span>
                        <strong>{segment.name}</strong>
                        <div className="studio-tools">
                          <button type="button" className="studio-btn" onClick={() => onMoveSegment(segment.id, -1)}>
                            ↑
                          </button>
                          <button type="button" className="studio-btn" onClick={() => onMoveSegment(segment.id, 1)}>
                            ↓
                          </button>
                          <button
                            type="button"
                            className="studio-btn studio-btn--danger"
                            onClick={() => onRemoveSegment(segment.id)}
                          >
                            {t('studio.remove')}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <button type="button" className="studio-btn studio-btn--danger" onClick={onDeleteRoute}>
                  {t('studio.deleteRoute')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <footer className="studio-rail__foot">
        <div className="studio-commit">
          <div className="studio-section__title-row">
            <h2>{t('studio.commit')}</h2>
            <span className={`studio-commit__state${dirty ? ' is-dirty' : ''}`}>
              {dirty ? t('studio.localChanges') : hasCommit ? t('studio.commitSaved') : t('studio.noChanges')}
            </span>
          </div>
          <div className="studio-commit__summary" aria-label={t('studio.commitContents')}>
            <span><strong>{commitSummary.metadataChanged}</strong>{t('studio.eventChanged')}</span>
            <span><strong>{commitSummary.upsertInfra}</strong>{t('studio.infraChanged')}</span>
            <span><strong>{commitSummary.removeInfra}</strong>{t('studio.infraRemoved')}</span>
            <span><strong>{commitSummary.upsertRoutes}</strong>{t('studio.routesChanged')}</span>
            <span><strong>{commitSummary.removeRoutes}</strong>{t('studio.routesRemoved')}</span>
          </div>
        </div>
        {message ? <p className="studio-message">{message}</p> : null}
        <div className="studio-tools">
          <button type="button" className="studio-btn studio-btn--primary" disabled={saving || (!dirty && hasCommit) || commitSummary.total === 0} onClick={onSave}>
            {saving ? t('studio.saving') : hasCommit ? t('studio.updateCommit') : t('studio.createCommit')}
          </button>
          <button type="button" className="studio-btn" disabled={!dirty || saving} onClick={onDiscard}>{t('studio.discardLocal')}</button>
          <button type="button" className="studio-btn" disabled={!canSubmit || saving} onClick={onSubmit}>
            {t('studio.submit')}
          </button>
        </div>
        <p className="studio-hint">
          {t('studio.scopeHint')}
        </p>
      </footer>
    </aside>
  )
}

function infraKindLabel(entity: InfraEntity, locale: Locale, words: { stop: string; street: string; track: string; portal: string }): string {
  const gauge = infraGauge(entity)
  const period = domain.validity(locale, entity.since, entity.until)
  const grade = infraWay(entity) === 'rail' ? infraGrade(entity) : undefined
  const gradeText =
    entity.nodeKind === 'portal'
      ? words.portal
      : grade === 'tunnel'
        ? `${domain.grade(locale, 'tunnel')} · ${domain.level(locale, infraLevel(entity))}`
        : grade === 'surface' && infraWay(entity) === 'rail'
          ? domain.grade(locale, 'surface')
          : ''
  const extra = [gauge ? String(gauge) : '', gradeText, period].filter(Boolean).join(' · ')
  const extraText = extra ? ` · ${extra}` : ''
  if (entity.kind === 'stop') {
    return `${words.stop}${extraText}`
  }
  if (entity.kind === 'node' && entity.nodeKind) {
    return `${domain.node(locale, entity.nodeKind)}${extraText}`
  }
  return `${infraWay(entity) === 'road' ? words.street : words.track}${extraText}`
}
