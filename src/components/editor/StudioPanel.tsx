import {
  GAUGE_PRESETS,
  TRACK_GRADES,
  TRANSPORT_WAYS,
  TUNNEL_LEVELS,
  canonicalGauge,
  gradeLabel,
  infraAliveAt,
  infraGauge,
  infraGrade,
  infraLevel,
  infraWay,
  levelLabel,
  modeLabel,
  modesForWay,
  nodeKindLabel,
  nodeKindsForWay,
  trackFormLabel,
  trackFormsForWay,
  validityLabel,
  wayLabel,
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
  saving: boolean
  message: string | null
  onTool: (tool: DrawTool) => void
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
  saving,
  message,
  onTool,
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
  onLogout,
}: StudioPanelProps) {
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
    ? selectedRoute.segmentIds
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
          <p className="studio-rail__kicker">Студия</p>
          <p className="studio-rail__user">{username}</p>
        </div>
        <button type="button" className="studio-btn studio-btn--ghost" onClick={onLogout}>
          Выйти
        </button>
      </header>

      <section className="studio-section">
        <div className="studio-section__title-row">
          <h2>Даты</h2>
          <button type="button" className="studio-btn" onClick={onNewDate}>
            Новая
          </button>
        </div>
        <Timeline dates={dates} date={draft.date} onDateChange={onSelectDate} embedded />
      </section>

      <section className="studio-section">
        <h2>Статья</h2>
        <label className="studio-field">
          Дата
          <input
            type="date"
            value={draft.date}
            onChange={(event) => onChange({ date: event.target.value })}
          />
        </label>
        <label className="studio-field">
          Вид транспорта
          <select
            value={draft.mode}
            onChange={(event) => onChange({ mode: event.target.value as TransportMode })}
          >
            {familyModes.map((mode) => (
              <option key={mode} value={mode}>
                {modeLabel(mode)}
              </option>
            ))}
          </select>
        </label>
        <label className="studio-field">
          Заголовок
          <input value={draft.title} onChange={(event) => onChange({ title: event.target.value })} />
        </label>
        <label className="studio-field">
          Текст
          <textarea
            rows={6}
            value={draft.summary}
            onChange={(event) => onChange({ summary: event.target.value })}
          />
        </label>
      </section>

      <section className="studio-section">
        <h2>Сеть</h2>
        <div className="studio-tabs">
          {TRANSPORT_WAYS.map((way) => (
            <button
              key={way.id}
              type="button"
              className={draft.way === way.id ? 'studio-btn is-on' : 'studio-btn'}
              onClick={() => onChange({ way: way.id })}
            >
              {way.label}
            </button>
          ))}
        </div>
        <div className="studio-tabs">
          <button
            type="button"
            className={draft.layer === 'infra' ? 'studio-btn is-on' : 'studio-btn'}
            onClick={() => onChange({ layer: 'infra' })}
          >
            Инфраструктура
          </button>
          <button
            type="button"
            className={draft.layer === 'route' ? 'studio-btn is-on' : 'studio-btn'}
            onClick={() => onChange({ layer: 'route' })}
          >
            Маршруты
          </button>
        </div>
        <div className="studio-fields-row">
          <label className="studio-field">
            Действует с
            <input type="date" value={currentSince} onChange={(event) => onDrawSince(event.target.value)} />
          </label>
          <label className="studio-field">
            {currentUntil ? 'по' : 'по · до сих пор'}
            <span className="studio-until">
              <input
                type="date"
                value={currentUntil}
                min={currentSince}
                onChange={(event) => onDrawUntil(event.target.value)}
              />
              {currentUntil ? (
                <button type="button" className="studio-btn" onClick={() => onDrawUntil('')}>
                  н.в.
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
            ? 'Дата «по» закрывает период. Кнопка «н.в.» снова открывает его.'
            : 'Открытая дата — действует до сих пор.'}
        </p>

        {draft.layer === 'infra' ? (
          <>
            <div className="studio-tools">
              <button
                type="button"
                className={tool === 'select' ? 'studio-btn is-on' : 'studio-btn'}
                onClick={() => onTool('select')}
              >
                Выбор
              </button>
              <button
                type="button"
                className={tool === 'track' ? 'studio-btn is-on' : 'studio-btn'}
                onClick={() => onTool('track')}
              >
                {draft.way === 'road' ? 'Улица' : 'Путь'}
              </button>
              <button
                type="button"
                className={tool === 'stop' ? 'studio-btn is-on' : 'studio-btn'}
                onClick={() => onTool('stop')}
              >
                Остановка
              </button>
              <button
                type="button"
                className={tool === 'node' ? 'studio-btn is-on' : 'studio-btn'}
                onClick={() => onTool('node')}
              >
                Узел
              </button>
            </div>
            {tool === 'track' || selectedInfra?.kind === 'track' ? (
              <label className="studio-field">
                {draft.way === 'road' ? 'Тип улицы' : 'Тип пути'}
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
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {tool === 'node' || selectedInfra?.kind === 'node' ? (
              <label className="studio-field">
                Элемент узла
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
                      {item.label}
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
                      {item.label}
                    </button>
                  ))}
                </div>
                {currentGrade === 'tunnel' ? (
                  <label className="studio-field">
                    Ярус
                    <select value={String(currentLevel)} onChange={(event) => applyLevel(Number(event.target.value))}>
                      {TUNNEL_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {levelLabel(level)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="studio-field">
                  Колея
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
                        {item.label}
                      </option>
                    ))}
                    <option value="custom">Своя ширина</option>
                  </select>
                </label>
                <label className="studio-field">
                  Ширина, мм
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
              Закреплять повороты
            </label>
            <p className="studio-hint">
              {tool === 'track'
                ? draft.way === 'road'
                  ? 'Сначала улицы, без номеров маршрутов. По ним потом лягут автобус и троллейбус.'
                  : currentGrade === 'tunnel'
                    ? 'Тоннели одного яруса стыкуются по концам. Разные ярусы пересекаются на карте, но не соединяются.'
                    : 'Наземные пути липнут к стыкам той же колеи. Тоннель — отдельно, выход на поверхность — точка-устье.'
                : tool === 'stop'
                  ? 'Кликни карту, чтобы поставить остановку.'
                  : tool === 'node'
                    ? draft.way === 'road'
                      ? 'Перекрёсток и конечная — точка; разворотное кольцо — линия.'
                      : nodeKind === 'portal'
                        ? 'Устье тоннеля: точка, к ней липнут и земля, и любой ярус тоннеля.'
                        : 'Кольцо, треугольник и съезд рисуются линией; узел, конечная и выход — точкой.'
                    : lockTurns
                      ? 'Повороты закреплены: клик рядом со стыком прилипает, свободный угол округляется.'
                      : 'Выбери объект на карте или в списке.'}{' '}
              Чтобы закрыть участок, укажи дату «по». Удаление стирает его из схемы.
            </p>
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
                    <span>{infraKindLabel(entity)}</span>
                    <strong>{entity.name}</strong>
                  </button>
                </li>
              ))}
            </ul>
            {selectedInfra ? (
              <div className="studio-feature">
                <label className="studio-field">
                  Имя
                  <input
                    value={selectedInfra.name}
                    onChange={(event) => onChangeInfra(selectedInfra.id, { name: event.target.value })}
                  />
                </label>
                <label className="studio-field">
                  Цвет
                  <input
                    type="color"
                    value={selectedInfra.color}
                    onChange={(event) => onChangeInfra(selectedInfra.id, { color: event.target.value })}
                  />
                </label>
                {selectedInfra.kind === 'track' ? (
                  <p className="studio-hint">{trackFormLabel(selectedInfra.trackForm, draft.way)}</p>
                ) : null}
                <div className="studio-tools">
                  {selectedInfra.geometry.type === 'LineString' ? (
                    <button type="button" className="studio-btn" onClick={onUndoVertex}>
                      Убрать точку
                    </button>
                  ) : null}
                  {selectedInfra.trackForm === 'single_oneway' &&
                  selectedInfra.geometry.type === 'LineString' ? (
                    <button type="button" className="studio-btn" onClick={onReverse}>
                      Развернуть
                    </button>
                  ) : null}
                  <button type="button" className="studio-btn studio-btn--danger" onClick={onDeleteInfra}>
                    Удалить объект
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <label className="studio-field">
              Номер
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
                Добавить маршрут
              </button>
            </div>
            <p className="studio-hint">
              Выбери маршрут и кликай участки {draft.way === 'road' ? 'улиц' : `рельсов ${canonicalGauge(drawGauge)} мм`} — они собираются в путь.
              Геометрию тут не рисуем. Чтобы закрыть маршрут, укажи дату «по». Удаление стирает его из схемы.
            </p>
            <ul className="studio-list studio-list--features">
              {routes.map((route) => {
                const period = validityLabel(route.since, route.until)
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
                  Имя
                  <input
                    value={selectedRoute.name}
                    onChange={(event) => onChangeRoute(selectedRoute.id, { name: event.target.value })}
                  />
                </label>
                <label className="studio-field">
                  Цвет
                  <input
                    type="color"
                    value={selectedRoute.color}
                    onChange={(event) => onChangeRoute(selectedRoute.id, { color: event.target.value })}
                  />
                </label>
                <p className="studio-hint">
                  Участки: {selectedSegments.length || 'пока нет'}
                </p>
                <ul className="studio-list studio-list--features">
                  {selectedSegments.map((segment) => (
                    <li key={segment.id}>
                      <div className="studio-list__item studio-list__item--static">
                        <span>
                          {trackFormLabel(segment.trackForm, draft.way)}
                          {validityLabel(segment.since, segment.until)
                            ? ` · ${validityLabel(segment.since, segment.until)}`
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
                            Убрать
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <button type="button" className="studio-btn studio-btn--danger" onClick={onDeleteRoute}>
                  Удалить маршрут
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <footer className="studio-rail__foot">
        {message ? <p className="studio-message">{message}</p> : null}
        <div className="studio-tools">
          <button type="button" className="studio-btn studio-btn--primary" disabled={saving} onClick={onSave}>
            {saving ? 'Сохранение…' : dirty ? 'Записать события' : 'Сохранено'}
          </button>
        </div>
        <p className="studio-hint">
          Инфраструктура пишется на весь {wayLabel(draft.way).toLowerCase()} транспорт, маршруты — только для{' '}
          {modeLabel(draft.mode).toLowerCase()}.
        </p>
      </footer>
    </aside>
  )
}

function infraKindLabel(entity: InfraEntity): string {
  const gauge = infraGauge(entity)
  const period = validityLabel(entity.since, entity.until)
  const grade = infraWay(entity) === 'rail' ? infraGrade(entity) : undefined
  const gradeText =
    entity.nodeKind === 'portal'
      ? 'устье'
      : grade === 'tunnel'
        ? `${gradeLabel('tunnel')} · ${levelLabel(infraLevel(entity))}`
        : grade === 'surface' && infraWay(entity) === 'rail'
          ? gradeLabel('surface')
          : ''
  const extra = [gauge ? String(gauge) : '', gradeText, period].filter(Boolean).join(' · ')
  const extraText = extra ? ` · ${extra}` : ''
  if (entity.kind === 'stop') {
    return `остановка${extraText}`
  }
  if (entity.kind === 'node' && entity.nodeKind) {
    return `${nodeKindLabel(entity.nodeKind)}${extraText}`
  }
  return `${infraWay(entity) === 'road' ? 'улица' : 'путь'}${extraText}`
}
