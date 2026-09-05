import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { EditorMap, type DraftFeature, type DrawTool } from '../components/editor/EditorMap'
import { StudioPanel, type DraftNetwork } from '../components/editor/StudioPanel'
import { useCatalog } from '../data/useCatalog'
import { useSession } from '../data/useSession'
import { api } from '../lib/api'
import {
  MODE_COLORS,
  WAY_COLORS,
  canonicalGauge,
  defaultGauge,
  defaultMode,
  gaugeColor,
  infraAliveAt,
  infraGauge,
  infraGrade,
  infraLevel,
  infraWay,
  modesForWay,
  nodeDrawsLine,
  periodsOverlap,
  sameGauge,
  wayOf,
  type InfraEntity,
  type NetworkState,
  type NodeKind,
  type RouteEntity,
  type Snapshot,
  type TrackForm,
  type TrackGrade,
  type TransportMode,
  type TransportWay,
} from '../types'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function newInfraId(city: string, way: string, kind: InfraEntity['kind']) {
  return `infra:${city}:${way}:${kind}:${crypto.randomUUID()}`
}

function routeId(city: string, mode: string, number: string) {
  return `route:${city}:${mode}:${number.trim() || '1'}`
}

function railProfile(way: TransportWay, grade: TrackGrade, level: number, portal = false) {
  if (way !== 'rail' || portal) {
    return { grade: undefined, level: undefined }
  }
  return { grade, level: grade === 'tunnel' ? level : undefined }
}

function chronicleFor(chronicles: Snapshot[], mode: TransportMode, date: string) {
  return chronicles
    .filter((item) => item.mode === mode && item.date <= date)
    .sort((left, right) => left.date.localeCompare(right.date))
    .at(-1)
}

function fromState(
  city: string,
  date: string,
  way: TransportWay,
  mode: TransportMode,
  layer: DraftNetwork['layer'],
  state: NetworkState,
): DraftNetwork {
  const chronicle = chronicleFor(state.chronicles, mode, date)
  return {
    city,
    date,
    way,
    mode,
    layer,
    title: chronicle?.title ?? '',
    summary: chronicle?.summary ?? '',
    infra: state.infra.map((entity) => ({
      ...entity,
      gauge: infraGauge(entity),
      grade: infraWay(entity) === 'rail' ? infraGrade(entity) : undefined,
      level: infraWay(entity) === 'rail' && infraGrade(entity) === 'tunnel' ? infraLevel(entity) : undefined,
      since: entity.since ?? date,
      until: entity.until,
    })),
    routes: state.routes.map((route) => ({
      ...route,
      since: route.since ?? date,
      until: route.until,
    })),
  }
}

function infraToFeature(entity: InfraEntity): DraftFeature {
  return {
    key: entity.id,
    type: 'Feature',
    properties: {
      kind: entity.kind,
      mode: entity.mode ?? defaultMode(infraWay(entity)),
      lineId: entity.id,
      number: '',
      name: entity.name,
      color: entity.color,
      trackForm: entity.trackForm,
      nodeKind: entity.nodeKind,
      layer: 'infra',
      infraId: entity.id,
      way: infraWay(entity),
      gauge: infraGauge(entity),
      grade: infraGrade(entity),
      level: infraGrade(entity) === 'tunnel' ? infraLevel(entity) : undefined,
      since: entity.since,
      until: entity.until,
    },
    geometry: entity.geometry,
  }
}

function routeToFeatures(route: RouteEntity, infra: InfraEntity[]): DraftFeature[] {
  return route.segmentIds.flatMap((segmentId) => {
    const segment = infra.find((entity) => entity.id === segmentId)
    if (!segment || segment.kind !== 'track') {
      return []
    }
    return [
      {
        key: `${route.id}:${segmentId}`,
        type: 'Feature' as const,
        properties: {
          kind: 'track' as const,
          mode: route.mode,
          lineId: route.id,
          number: route.number,
          name: route.name,
          color: route.color,
          trackForm: segment.trackForm,
          layer: 'route' as const,
          infraId: segment.id,
          way: infraWay(segment),
          gauge: infraGauge(segment),
          grade: infraGrade(segment),
          level: infraGrade(segment) === 'tunnel' ? infraLevel(segment) : undefined,
          since: route.since,
          until: route.until,
        },
        geometry: segment.geometry,
      },
    ]
  })
}

export function EditorPage() {
  const { user, loading, setUser } = useSession()
  const { catalog, error, reload } = useCatalog({ loadNetworks: false })
  const [draft, setDraft] = useState<DraftNetwork | null>(null)
  const [baseline, setBaseline] = useState('')
  const [chronicles, setChronicles] = useState<Snapshot[]>([])
  const [selectedInfraId, setSelectedInfraId] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [tool, setTool] = useState<DrawTool>('select')
  const [drawNumber, setDrawNumber] = useState('1')
  const [trackForm, setTrackForm] = useState<TrackForm>('single_both')
  const [nodeKind, setNodeKind] = useState<NodeKind>('junction')
  const [drawGauge, setDrawGauge] = useState(defaultGauge('tram'))
  const [drawGrade, setDrawGrade] = useState<TrackGrade>('surface')
  const [drawLevel, setDrawLevel] = useState(-1)
  const [drawSince, setDrawSince] = useState(today())
  const [drawUntil, setDrawUntil] = useState('')
  const [lockTurns, setLockTurns] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)

  const city = catalog?.cities[0]
  const dates = catalog?.dates ?? []
  const booted = useRef(false)
  const dirty = useMemo(() => (draft ? JSON.stringify(draft) !== baseline : false), [baseline, draft])

  async function login(event: FormEvent) {
    event.preventDefault()
    setLoginError(null)
    try {
      const body = await api<{ user: { username: string } }>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setUser(body.user)
      setPassword('')
    } catch {
      setLoginError('Неверный логин или пароль')
    }
  }

  async function logout() {
    await api('/api/logout', { method: 'POST' }).catch(() => undefined)
    setUser(null)
  }

  async function loadDate(date: string, way: TransportWay, mode: TransportMode, layer: DraftNetwork['layer']) {
    if (!city) {
      return
    }
    const state = await api<NetworkState>(
      `/api/state?city=${encodeURIComponent(city.id)}&date=${encodeURIComponent(date)}`,
    )
    const next = fromState(city.id, date, way, mode, layer, state)
    setChronicles(state.chronicles)
    setDraft(next)
    setBaseline(JSON.stringify(next))
    setSelectedInfraId(null)
    setSelectedRouteId(next.routes.find((route) => route.mode === mode)?.id ?? null)
    setTool('select')
    setDrawSince(date)
    setDrawUntil('')
    setMessage(null)
  }

  useEffect(() => {
    if (!user || !city || !catalog || booted.current) {
      return
    }
    booted.current = true
    void loadDate(catalog.dates.at(-1) ?? today(), 'rail', 'tram', 'infra')
  }, [user, city, catalog])

  function confirmLeave() {
    return !dirty || window.confirm('Есть несохранённые правки. Продолжить?')
  }

  function startNewDate() {
    if (!city || !draft || !confirmLeave()) {
      return
    }
    const date = today()
    const next = {
      ...draft,
      date,
      title: chronicleFor(chronicles, draft.mode, date)?.title ?? '',
      summary: chronicleFor(chronicles, draft.mode, date)?.summary ?? '',
    }
    setDraft(next)
    setBaseline(JSON.stringify(next))
    setDrawSince(date)
    setMessage(null)
  }

  function patchDraft(patch: Partial<DraftNetwork>) {
    setDraft((current) => {
      if (!current) {
        return current
      }
      const next = { ...current, ...patch }
      if (patch.date && patch.date !== current.date) {
        setDrawSince(patch.date)
      }
      if (patch.way && patch.way !== current.way) {
        next.mode = modesForWay(patch.way).includes(current.mode) ? current.mode : defaultMode(patch.way)
        const chronicle = chronicleFor(chronicles, next.mode, next.date)
        next.title = chronicle?.title ?? ''
        next.summary = chronicle?.summary ?? ''
        setSelectedInfraId(null)
        setSelectedRouteId(next.routes.find((route) => route.mode === next.mode)?.id ?? null)
        if (patch.way === 'road' && (nodeKind === 'wye' || nodeKind === 'crossover' || nodeKind === 'portal')) {
          setNodeKind('junction')
        }
        setDrawGauge(defaultGauge(next.mode))
      }
      if (patch.mode && patch.mode !== current.mode) {
        next.way = wayOf(patch.mode)
        setDrawGauge(defaultGauge(patch.mode))
        const chronicle = chronicleFor(chronicles, patch.mode, next.date)
        next.title = chronicle?.title ?? ''
        next.summary = chronicle?.summary ?? ''
        setSelectedInfraId(null)
        setSelectedRouteId(next.routes.find((route) => route.mode === patch.mode)?.id ?? null)
      }
      if (patch.layer === 'route') {
        setTool('select')
      }
      return next
    })
  }

  function updateInfra(id: string, mapper: (entity: InfraEntity) => InfraEntity) {
    setDraft((current) =>
      current
        ? { ...current, infra: current.infra.map((entity) => (entity.id === id ? mapper(entity) : entity)) }
        : current,
    )
  }

  function updateRoute(id: string, mapper: (entity: RouteEntity) => RouteEntity) {
    setDraft((current) =>
      current
        ? { ...current, routes: current.routes.map((entity) => (entity.id === id ? mapper(entity) : entity)) }
        : current,
    )
  }

  function handleMapClick(lng: number, lat: number) {
    if (!draft || draft.layer !== 'infra') {
      return
    }
    if (tool === 'stop') {
      const id = newInfraId(draft.city, draft.way, 'stop')
      const entity: InfraEntity = {
        id,
        kind: 'stop',
        way: draft.way,
        gauge: draft.way === 'rail' ? canonicalGauge(drawGauge) : undefined,
        ...railProfile(draft.way, drawGrade, drawLevel),
        since: drawSince,
        until: drawUntil || undefined,
        name: 'Остановка',
        color: MODE_COLORS[draft.mode],
        trackForm,
        geometry: { type: 'Point', coordinates: [lng, lat] },
      }
      setDraft((current) => (current ? { ...current, infra: [...current.infra, entity] } : current))
      setSelectedInfraId(id)
      return
    }

    const drawingLine = tool === 'track' || (tool === 'node' && nodeDrawsLine(nodeKind))
    if (drawingLine) {
      if (selectedInfraId) {
        let appended = false
        setDraft((current) => {
          if (!current) {
            return current
          }
          const selected = current.infra.find((entity) => entity.id === selectedInfraId)
          if (!selected || selected.geometry.type !== 'LineString') {
            return current
          }
          if (tool === 'track' && selected.kind !== 'track') {
            return current
          }
          if (tool === 'node' && selected.kind !== 'node') {
            return current
          }
          appended = true
          return {
            ...current,
            infra: current.infra.map((entity) =>
              entity.id === selectedInfraId && entity.geometry.type === 'LineString'
                ? {
                    ...entity,
                    geometry: {
                      type: 'LineString',
                      coordinates: [...entity.geometry.coordinates, [lng, lat]],
                    },
                  }
                : entity,
            ),
          }
        })
        if (appended) {
          return
        }
      }
      const isNode = tool === 'node'
      const id = newInfraId(draft.city, draft.way, isNode ? 'node' : 'track')
      const entity: InfraEntity = {
        id,
        kind: isNode ? 'node' : 'track',
        way: draft.way,
        gauge: draft.way === 'rail' ? canonicalGauge(drawGauge) : undefined,
        ...railProfile(draft.way, drawGrade, drawLevel),
        since: drawSince,
        until: drawUntil || undefined,
        name: isNode ? 'Узел' : draft.way === 'road' ? 'Улица' : drawGrade === 'tunnel' ? 'Тоннель' : 'Путь',
        color: isNode ? MODE_COLORS[draft.mode] : draft.way === 'rail' ? gaugeColor(drawGauge) : WAY_COLORS.road,
        trackForm,
        nodeKind: isNode ? nodeKind : undefined,
        geometry: { type: 'LineString', coordinates: [[lng, lat]] },
      }
      setDraft((current) => (current ? { ...current, infra: [...current.infra, entity] } : current))
      setSelectedInfraId(id)
      return
    }

    if (tool !== 'node') {
      return
    }
    const id = newInfraId(draft.city, draft.way, 'node')
    const entity: InfraEntity = {
      id,
      kind: 'node',
      way: draft.way,
      gauge: draft.way === 'rail' ? canonicalGauge(drawGauge) : undefined,
      ...railProfile(draft.way, drawGrade, drawLevel, nodeKind === 'portal'),
      since: drawSince,
      until: drawUntil || undefined,
      name: nodeKind === 'portal' ? 'Выход' : 'Узел',
      color: MODE_COLORS[draft.mode],
      trackForm,
      nodeKind,
      geometry: { type: 'Point', coordinates: [lng, lat] },
    }
    setDraft((current) => (current ? { ...current, infra: [...current.infra, entity] } : current))
    setSelectedInfraId(id)
  }

  function toggleSegment(infraId: string) {
    if (!draft || !selectedRouteId) {
      setMessage('Сначала выбери или добавь маршрут')
      return
    }
    const segment = draft.infra.find((entity) => entity.id === infraId)
    if (!segment || segment.kind !== 'track' || infraWay(segment) !== draft.way) {
      return
    }
    const alreadyOnRoute = draft.routes.some((route) => route.id === selectedRouteId && route.segmentIds.includes(infraId))
    const route = draft.routes.find((item) => item.id === selectedRouteId)
    if (!alreadyOnRoute && !infraAliveAt(segment, draft.date)) {
      setMessage(`Этот путь не действует ${draft.date}`)
      return
    }
    if (!alreadyOnRoute && route && !periodsOverlap(route, segment)) {
      setMessage('Период пути не пересекается с периодом маршрута')
      return
    }
    if (draft.way === 'rail') {
      const currentGauge =
        route?.segmentIds
          .map((id) => draft.infra.find((entity) => entity.id === id))
          .map((entity) => (entity ? infraGauge(entity) : undefined))
          .find((value): value is number => value != null) ?? drawGauge
      const segmentGauge = infraGauge(segment)
      if (segmentGauge != null && !sameGauge(segmentGauge, currentGauge)) {
        setMessage(`Маршрут идёт по колее ${currentGauge} мм, этот путь — ${segmentGauge} мм`)
        return
      }
    }
    setDraft((current) => {
      if (!current) {
        return current
      }
      return {
        ...current,
        routes: current.routes.map((route) => {
          if (route.id !== selectedRouteId) {
            return route
          }
          const exists = route.segmentIds.includes(infraId)
          return {
            ...route,
            segmentIds: exists
              ? route.segmentIds.filter((id) => id !== infraId)
              : [...route.segmentIds, infraId],
          }
        }),
      }
    })
  }

  async function save() {
    if (!draft) {
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      await api('/api/commit', {
        method: 'POST',
        body: JSON.stringify({
          city: draft.city,
          date: draft.date,
          way: draft.way,
          mode: draft.mode,
          title: draft.title.trim(),
          summary: draft.summary,
          infra: draft.infra.filter(
            (entity) =>
              infraWay(entity) === draft.way &&
              (entity.geometry.type !== 'LineString' || entity.geometry.coordinates.length >= 2),
          ),
          routes: draft.routes.filter((entity) => entity.mode === draft.mode),
        }),
      })
      setBaseline(JSON.stringify(draft))
      setMessage('События записаны')
      reload()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="app-status">Вход…</p>
  }

  if (!user) {
    return (
      <div className="gate">
        <form className="gate__card" onSubmit={login}>
          <p className="gate__kicker">Студия</p>
          <h1 className="gate__title">Правка сети</h1>
          <p className="gate__lead">
            Сначала рельсы или улицы, затем маршруты по ним. Публичной ссылки нет.
          </p>
          <label className="studio-field">
            Логин
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="studio-field">
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {loginError ? <p className="studio-message">{loginError}</p> : null}
          <button type="submit" className="studio-btn studio-btn--primary">
            Войти
          </button>
        </form>
      </div>
    )
  }

  if (error) {
    return <p className="app-status">{error}</p>
  }

  if (!city || !draft) {
    return <p className="app-status">Загрузка студии…</p>
  }

  const infraOfWay = draft.infra.filter((entity) => infraWay(entity) === draft.way)
  const routesOfMode = draft.routes.filter((route) => route.mode === draft.mode)
  const orderedRoutes = [
    ...routesOfMode.filter((route) => route.id !== selectedRouteId && infraAliveAt(route, draft.date)),
    ...routesOfMode.filter((route) => route.id === selectedRouteId),
  ]
  const mapFeatures: DraftFeature[] =
    draft.layer === 'infra'
      ? infraOfWay.map(infraToFeature)
      : [...infraOfWay.map(infraToFeature), ...orderedRoutes.flatMap((route) => routeToFeatures(route, infraOfWay))]
  const selectedInfra = draft.infra.find((entity) => entity.id === selectedInfraId)

  return (
    <div className="studio">
      <EditorMap
        city={city}
        features={mapFeatures}
        selectedKey={draft.layer === 'infra' ? selectedInfraId : selectedRouteId}
        tool={draft.layer === 'infra' ? tool : 'select'}
        enableVertices={draft.layer === 'infra'}
        muteInfra={draft.layer === 'route'}
        lockTurns={lockTurns}
        snapWay={draft.way}
        activeGauge={draft.way === 'rail' ? drawGauge : undefined}
        activeGrade={
          draft.way === 'rail' ? (tool === 'node' && nodeKind === 'portal' ? 'portal' : drawGrade) : undefined
        }
        activeLevel={draft.way === 'rail' && drawGrade === 'tunnel' ? drawLevel : undefined}
        activeDate={draft.date}
        routePeriod={
          draft.layer === 'route'
            ? {
                since: draft.routes.find((route) => route.id === selectedRouteId)?.since ?? drawSince,
                until: draft.routes.find((route) => route.id === selectedRouteId)?.until ?? (drawUntil || undefined),
              }
            : undefined
        }
        previousPoint={
          selectedInfra?.geometry.type === 'LineString'
            ? selectedInfra.geometry.coordinates.at(-1)
            : undefined
        }
        onSelect={(feature) => {
          if (draft.layer === 'route') {
            const infraId = feature.properties.infraId
            if (infraId && draft.infra.some((entity) => entity.id === infraId && entity.kind === 'track' && infraWay(entity) === draft.way)) {
              toggleSegment(infraId)
            }
            return
          }
          setSelectedInfraId(feature.key)
          const entity = draft.infra.find((item) => item.id === feature.key)
          if (entity?.kind === 'track') {
            setTrackForm(entity.trackForm)
          }
          if (entity?.kind === 'node' && entity.nodeKind) {
            setNodeKind(entity.nodeKind)
          }
          const gauge = entity ? infraGauge(entity) : undefined
          if (gauge) {
            setDrawGauge(gauge)
          }
          if (entity && entity.nodeKind !== 'portal') {
            setDrawGrade(infraGrade(entity))
            if (infraGrade(entity) === 'tunnel') {
              setDrawLevel(infraLevel(entity))
            }
          }
          if (entity?.since) {
            setDrawSince(entity.since)
          }
          setDrawUntil(entity?.until ?? '')
        }}
        onMapClick={handleMapClick}
        onMoveVertex={(key, index, coord) =>
          updateInfra(key, (entity) => {
            if (entity.geometry.type !== 'LineString') {
              return entity
            }
            const coordinates = entity.geometry.coordinates.slice()
            coordinates[index] = coord
            return { ...entity, geometry: { type: 'LineString', coordinates } }
          })
        }
        onMovePoint={(key, coord) =>
          updateInfra(key, (entity) =>
            entity.geometry.type === 'Point' ? { ...entity, geometry: { type: 'Point', coordinates: coord } } : entity,
          )
        }
      />
      <StudioPanel
        username={user.username}
        dates={dates}
        lines={catalog?.lines ?? []}
        draft={draft}
        selectedInfraId={selectedInfraId}
        selectedRouteId={selectedRouteId}
        tool={tool}
        drawNumber={drawNumber}
        trackForm={trackForm}
        nodeKind={nodeKind}
        drawGauge={drawGauge}
        drawGrade={drawGrade}
        drawLevel={drawLevel}
        drawSince={drawSince}
        drawUntil={drawUntil}
        lockTurns={lockTurns}
        dirty={dirty}
        saving={saving}
        message={message}
        onTool={setTool}
        onDrawNumber={setDrawNumber}
        onTrackForm={setTrackForm}
        onNodeKind={setNodeKind}
        onDrawGauge={(value) => setDrawGauge(canonicalGauge(value))}
        onDrawGrade={(value) => {
          setDrawGrade(value)
          if (value === 'tunnel' && drawLevel >= 0) {
            setDrawLevel(-1)
          }
        }}
        onDrawLevel={setDrawLevel}
        onDrawSince={(value) => {
          setDrawSince(value)
          if (draft.layer === 'infra' && selectedInfraId) {
            updateInfra(selectedInfraId, (entity) => ({ ...entity, since: value }))
          }
          if (draft.layer === 'route' && selectedRouteId) {
            updateRoute(selectedRouteId, (entity) => ({ ...entity, since: value }))
          }
        }}
        onDrawUntil={(value) => {
          setDrawUntil(value)
          if (draft.layer === 'infra' && selectedInfraId) {
            updateInfra(selectedInfraId, (entity) => ({ ...entity, until: value || undefined }))
          }
          if (draft.layer === 'route' && selectedRouteId) {
            updateRoute(selectedRouteId, (entity) => ({ ...entity, until: value || undefined }))
          }
        }}
        onLockTurns={setLockTurns}
        onSelectDate={(date) => {
          if (!confirmLeave()) {
            return
          }
          void loadDate(date, draft.way, draft.mode, draft.layer)
        }}
        onNewDate={startNewDate}
        onChange={patchDraft}
        onSelectInfra={(id) => {
          setSelectedInfraId(id)
          const entity = draft.infra.find((item) => item.id === id)
          if (entity?.kind === 'track') {
            setTrackForm(entity.trackForm)
          }
          if (entity?.kind === 'node' && entity.nodeKind) {
            setNodeKind(entity.nodeKind)
          }
          const gauge = entity ? infraGauge(entity) : undefined
          if (gauge) {
            setDrawGauge(gauge)
          }
          if (entity && entity.nodeKind !== 'portal') {
            setDrawGrade(infraGrade(entity))
            if (infraGrade(entity) === 'tunnel') {
              setDrawLevel(infraLevel(entity))
            }
          }
          if (entity?.since) {
            setDrawSince(entity.since)
          }
          setDrawUntil(entity?.until ?? '')
        }}
        onChangeInfra={(id, patch) => {
          const target = draft.infra.find((entity) => entity.id === id)
          if (!target) {
            return
          }
          if (patch.nodeKind) {
            const wantsLine = nodeDrawsLine(patch.nodeKind)
            const isLine = target.geometry.type === 'LineString'
            if (wantsLine !== isLine) {
              return
            }
          }
          updateInfra(id, (entity) => {
            const nextGrade = patch.grade ?? entity.grade
            return {
              ...entity,
              ...patch,
              gauge: patch.gauge != null ? canonicalGauge(patch.gauge) : entity.gauge,
              until: patch.until !== undefined ? patch.until || undefined : entity.until,
              grade: nextGrade,
              level: nextGrade === 'tunnel' ? (patch.level !== undefined ? patch.level : entity.level ?? -1) : undefined,
            }
          })
        }}
        onDeleteInfra={() => {
          if (!selectedInfraId) {
            return
          }
          setDraft((current) =>
            current
              ? {
                  ...current,
                  infra: current.infra.filter((entity) => entity.id !== selectedInfraId),
                  routes: current.routes.map((route) => ({
                    ...route,
                    segmentIds: route.segmentIds.filter((id) => id !== selectedInfraId),
                  })),
                }
              : current,
          )
          setSelectedInfraId(null)
        }}
        onUndoVertex={() => {
          if (!selectedInfra || selectedInfra.geometry.type !== 'LineString') {
            return
          }
          const coordinates = selectedInfra.geometry.coordinates.slice(0, -1)
          if (coordinates.length === 0) {
            patchDraft({
              infra: draft.infra.filter((entity) => entity.id !== selectedInfra.id),
              routes: draft.routes.map((route) => ({
                ...route,
                segmentIds: route.segmentIds.filter((id) => id !== selectedInfra.id),
              })),
            })
            setSelectedInfraId(null)
            return
          }
          updateInfra(selectedInfra.id, (entity) =>
            entity.geometry.type === 'LineString'
              ? { ...entity, geometry: { type: 'LineString', coordinates } }
              : entity,
          )
        }}
        onReverse={() => {
          if (!selectedInfra || selectedInfra.geometry.type !== 'LineString') {
            return
          }
          updateInfra(selectedInfra.id, (entity) =>
            entity.geometry.type === 'LineString'
              ? { ...entity, geometry: { type: 'LineString', coordinates: [...entity.geometry.coordinates].reverse() } }
              : entity,
          )
        }}
        onSelectRoute={(id) => {
          setSelectedRouteId(id)
          const route = draft.routes.find((item) => item.id === id)
          if (route?.since) {
            setDrawSince(route.since)
          }
          setDrawUntil(route?.until ?? '')
        }}
        onChangeRoute={(id, patch) => {
          const number = patch.number !== undefined ? patch.number.trim() || '1' : undefined
          if (number !== undefined) {
            setSelectedRouteId(routeId(draft.city, draft.mode, number))
          }
          setDraft((current) => {
            if (!current) {
              return current
            }
            return {
              ...current,
              routes: current.routes.map((route) => {
                if (route.id !== id) {
                  return route
                }
                const nextNumber = number ?? route.number
                return {
                  ...route,
                  ...patch,
                  number: nextNumber,
                  id: number !== undefined ? routeId(current.city, current.mode, nextNumber) : route.id,
                }
              }),
            }
          })
        }}
        onAddRoute={() => {
          const number = drawNumber.trim() || '1'
          const id = routeId(draft.city, draft.mode, number)
          const existing = draft.routes.find((route) => route.id === id)
          if (existing) {
            setSelectedRouteId(id)
            if (existing.since) {
              setDrawSince(existing.since)
            }
            setDrawUntil(existing.until ?? '')
            return
          }
          const route: RouteEntity = {
            id,
            mode: draft.mode,
            number,
            name: `Маршрут №${number}`,
            color: MODE_COLORS[draft.mode],
            segmentIds: [],
            since: drawSince,
            until: drawUntil || undefined,
          }
          setDraft((current) => (current ? { ...current, routes: [...current.routes, route] } : current))
          setSelectedRouteId(id)
        }}
        onDeleteRoute={() => {
          if (!selectedRouteId) {
            return
          }
          setDraft((current) =>
            current ? { ...current, routes: current.routes.filter((route) => route.id !== selectedRouteId) } : current,
          )
          setSelectedRouteId(null)
        }}
        onMoveSegment={(segmentId, direction) => {
          if (!selectedRouteId) {
            return
          }
          setDraft((current) => {
            if (!current) {
              return current
            }
            return {
              ...current,
              routes: current.routes.map((route) => {
                if (route.id !== selectedRouteId) {
                  return route
                }
                const index = route.segmentIds.indexOf(segmentId)
                const next = index + direction
                if (index < 0 || next < 0 || next >= route.segmentIds.length) {
                  return route
                }
                const segmentIds = route.segmentIds.slice()
                const [item] = segmentIds.splice(index, 1)
                if (!item) {
                  return route
                }
                segmentIds.splice(next, 0, item)
                return { ...route, segmentIds }
              }),
            }
          })
        }}
        onRemoveSegment={(segmentId) => toggleSegment(segmentId)}
        onSave={() => void save()}
        onLogout={() => void logout()}
      />
    </div>
  )
}
