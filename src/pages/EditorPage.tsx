import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EditorMap, type DraftFeature, type DrawTool } from '../components/editor/EditorMap'
import { StudioPanel, type DraftNetwork } from '../components/editor/StudioPanel'
import { useCatalog } from '../data/useCatalog'
import { useSession } from '../data/useSession'
import { api } from '../lib/api'
import { useI18n } from '../i18n'
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
  type MapViewport,
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

function newInfraId(way: string, kind: InfraEntity['kind']) {
  return `infra:${way}:${kind}:${crypto.randomUUID()}`
}

function newRouteId(mode: string) {
  return `route:${mode}:${crypto.randomUUID()}`
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
  if (route.geometry && route.geometry.coordinates.length >= 2) {
    return [{
      key: route.id,
      type: 'Feature',
      properties: {
        kind: 'track', mode: route.mode, lineId: route.id, number: route.number, name: route.name,
        color: route.color, trackForm: 'single_both', layer: 'route', way: 'road', since: route.since, until: route.until,
      },
      geometry: route.geometry,
    }]
  }
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
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const workspaceId = searchParams.get('workspace') || 'main'
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
  const [lockTurns, setLockTurns] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [viewport, setViewport] = useState<MapViewport | null>(null)
  const [changeSetId, setChangeSetId] = useState<string | null>(null)

  const city = catalog?.cities[0]
  const dates = catalog?.dates ?? []
  const booted = useRef(false)
  const dirty = useMemo(() => (draft ? JSON.stringify(draft) !== baseline : false), [baseline, draft])
  const dirtyRef = useRef(dirty)

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  async function login(event: FormEvent) {
    event.preventDefault()
    setLoginError(null)
    try {
      const body = await api<{ user: { username: string; role: string; preferredLanguage: string | null } }>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setUser(body.user)
      setPassword('')
    } catch {
      setLoginError(t('login.error'))
    }
  }

  async function logout() {
    await api('/api/logout', { method: 'POST' }).catch(() => undefined)
    setUser(null)
  }

  const loadDate = useCallback(async function loadDate(
    date: string,
    way: TransportWay,
    mode: TransportMode,
    layer: DraftNetwork['layer'],
    preserveEdits = false,
  ) {
    if (!city) {
      return
    }
    const bounds = viewport?.bounds ?? {
      west: city.center[1] - 0.75,
      south: city.center[0] - 0.45,
      east: city.center[1] + 0.75,
      north: city.center[0] + 0.45,
    }
    const bbox = [bounds.west, bounds.south, bounds.east, bounds.north].join(',')
    const state = await api<NetworkState>(
      `/api/map?bbox=${encodeURIComponent(bbox)}&date=${encodeURIComponent(date)}&zoom=${viewport?.zoom ?? 13}&detail=editor&workspace=${encodeURIComponent(workspaceId)}`,
    )
    if (preserveEdits && dirtyRef.current) return
    const next = fromState('world', date, way, mode, layer, state)
    setChronicles(state.chronicles)
    setDraft(next)
    setBaseline(JSON.stringify(next))
    setSelectedInfraId(null)
    setSelectedRouteId(next.routes.find((route) => route.mode === mode)?.id ?? null)
    setTool('select')
    setDrawSince(date)
    setDrawUntil('')
    setMessage(null)
    setChangeSetId(null)
  }, [city, viewport, workspaceId])

  useEffect(() => {
    if (!user || !city || !catalog || booted.current) {
      return
    }
    booted.current = true
    void loadDate(catalog.dates.at(-1) ?? today(), 'rail', 'tram', 'infra')
  }, [user, city, catalog, loadDate])

  const draftDate = draft?.date
  const draftWay = draft?.way
  const draftMode = draft?.mode
  const draftLayer = draft?.layer

  useEffect(() => {
    if (!user || !viewport || !draftDate || !draftWay || !draftMode || !draftLayer || dirty) return
    const timer = window.setTimeout(() => {
      void loadDate(draftDate, draftWay, draftMode, draftLayer, true)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [viewport, user, dirty, draftDate, draftWay, draftMode, draftLayer, loadDate])

  function confirmLeave() {
    return !dirty || window.confirm(t('studio.unsavedConfirm'))
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
    if (!draft) {
      return
    }
    if (draft.layer === 'route' && draft.mode === 'bus' && tool === 'route' && selectedRouteId) {
      updateRoute(selectedRouteId, (route) => ({
        ...route,
        segmentIds: [],
        geometry: { type: 'LineString', coordinates: [...(route.geometry?.coordinates ?? []), [lng, lat]] },
      }))
      return
    }
    if (draft.layer !== 'infra') return
    if (tool === 'stop') {
      const id = newInfraId(draft.way, 'stop')
      const entity: InfraEntity = {
        id,
        kind: 'stop',
        way: draft.way,
        mode: draft.mode,
        gauge: draft.way === 'rail' ? canonicalGauge(drawGauge) : undefined,
        ...railProfile(draft.way, drawGrade, drawLevel),
        since: drawSince,
        until: drawUntil || undefined,
        name: t('studio.stop'),
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
      const id = newInfraId(draft.way, isNode ? 'node' : 'track')
      const entity: InfraEntity = {
        id,
        kind: isNode ? 'node' : 'track',
        way: draft.way,
        mode: draft.mode,
        gauge: draft.way === 'rail' ? canonicalGauge(drawGauge) : undefined,
        ...railProfile(draft.way, drawGrade, drawLevel),
        since: drawSince,
        until: drawUntil || undefined,
        name: isNode ? t('studio.node') : draft.way === 'road' ? t('studio.street') : drawGrade === 'tunnel' ? t('studio.portal') : t('studio.track'),
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
    const id = newInfraId(draft.way, 'node')
    const entity: InfraEntity = {
      id,
      kind: 'node',
      way: draft.way,
      mode: draft.mode,
      gauge: draft.way === 'rail' ? canonicalGauge(drawGauge) : undefined,
      ...railProfile(draft.way, drawGrade, drawLevel, nodeKind === 'portal'),
      since: drawSince,
      until: drawUntil || undefined,
      name: nodeKind === 'portal' ? t('studio.portal') : t('studio.node'),
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
      setMessage(t('studio.chooseRoute'))
      return
    }
    const segment = draft.infra.find((entity) => entity.id === infraId)
    if (!segment || segment.kind !== 'track' || infraWay(segment) !== draft.way) {
      return
    }
    if (draft.mode === 'trolleybus' && segment.mode !== 'trolleybus') {
      setMessage(t('studio.trolleyWireMismatch'))
      return
    }
    const alreadyOnRoute = draft.routes.some((route) => route.id === selectedRouteId && route.segmentIds.includes(infraId))
    const route = draft.routes.find((item) => item.id === selectedRouteId)
    if (!alreadyOnRoute && !infraAliveAt(segment, draft.date)) {
      setMessage(`${t('studio.inactiveTrack')} ${draft.date}`)
      return
    }
    if (!alreadyOnRoute && route && !periodsOverlap(route, segment)) {
      setMessage(t('studio.periodMismatch'))
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
        setMessage(`${t('studio.gaugeMismatch')} ${currentGauge} mm / ${segmentGauge} mm`)
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
    const before = JSON.parse(baseline) as DraftNetwork
    const beforeInfra = new Map(before.infra.map((entity) => [entity.id, entity]))
    const beforeRoutes = new Map(before.routes.map((route) => [route.id, route]))
    const currentInfra = draft.infra.filter(
      (entity) => entity.geometry.type !== 'LineString' || entity.geometry.coordinates.length >= 2,
    )
    const upsertInfra = currentInfra.filter(
      (entity) => JSON.stringify(entity) !== JSON.stringify(beforeInfra.get(entity.id)),
    )
    const upsertRoutes = draft.routes.filter(
      (route) => JSON.stringify(route) !== JSON.stringify(beforeRoutes.get(route.id)),
    )
    const currentInfraIds = new Set(currentInfra.map((entity) => entity.id))
    const currentRouteIds = new Set(draft.routes.map((route) => route.id))
    setSaving(true)
    setMessage(null)
    try {
      const saved = await api<{ id: string; status: string; operations: number }>('/api/objects/commit', {
        method: 'POST',
        body: JSON.stringify({
          date: draft.date,
          mode: draft.mode,
          changeSetId,
          workspaceId,
          title: draft.title.trim(),
          summary: draft.summary,
          upsertInfra,
          removeInfra: before.infra.map((entity) => entity.id).filter((id) => !currentInfraIds.has(id)),
          upsertRoutes,
          removeRoutes: before.routes.map((route) => route.id).filter((id) => !currentRouteIds.has(id)),
        }),
      })
      setChangeSetId(saved.id)
      setBaseline(JSON.stringify(draft))
      setMessage(`${t('studio.saved')} · ${saved.operations} ${t('studio.changesCount')}`)
      reload()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('studio.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function submitForReview() {
    if (!changeSetId || dirty) return
    setSaving(true)
    setMessage(null)
    try {
      await api(`/api/changesets/${encodeURIComponent(changeSetId)}/submit`, { method: 'POST' })
      setMessage(t('studio.submitted'))
      setChangeSetId(null)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('studio.submitFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="app-status">{t('loading')}</p>
  }

  if (!user) {
    return (
      <div className="gate">
        <form className="gate__card" onSubmit={login}>
          <p className="gate__kicker">{t('login.studio')}</p>
          <h1 className="gate__title">{t('login.title')}</h1>
          <p className="gate__lead" hidden>
            Сначала рельсы или улицы, затем маршруты по ним. Публичной ссылки нет.
          </p>
          <label className="studio-field">
            {t('login.username')}
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="studio-field">
            {t('login.password')}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {loginError ? <p className="studio-message">{loginError}</p> : null}
          <button type="submit" className="studio-btn studio-btn--primary">
            {t('login.submit')}
          </button>
        </form>
      </div>
    )
  }

  if (error) {
    return <p className="app-status">{error}</p>
  }

  if (!city || !draft) {
    return <p className="app-status">{t('loading')}</p>
  }

  const infraOfWay = draft.infra.filter((entity) =>
    infraWay(entity) === draft.way && (draft.mode !== 'trolleybus' || entity.mode === 'trolleybus'))
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
        tool={draft.layer === 'route' && draft.mode === 'bus' ? 'route' : draft.layer === 'infra' ? tool : 'select'}
        enableVertices={draft.layer === 'infra' || (draft.layer === 'route' && draft.mode === 'bus')}
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
          draft.layer === 'route' && draft.mode === 'bus'
            ? draft.routes.find((route) => route.id === selectedRouteId)?.geometry?.coordinates.at(-1)
            : selectedInfra?.geometry.type === 'LineString'
            ? selectedInfra.geometry.coordinates.at(-1)
            : undefined
        }
        onSelect={(feature) => {
          if (draft.layer === 'route') {
            if (draft.mode !== 'bus') {
              const infraId = feature.properties.infraId
              if (infraId && draft.infra.some((entity) => entity.id === infraId && entity.kind === 'track' && infraWay(entity) === draft.way)) {
                toggleSegment(infraId)
              }
            } else if (feature.properties.layer === 'route') {
              setSelectedRouteId(feature.properties.lineId)
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
        onMoveVertex={(key, index, coord) => {
          if (draft.layer === 'route' && draft.mode === 'bus') {
            updateRoute(key, (route) => {
              if (!route.geometry) return route
              const coordinates = route.geometry.coordinates.slice()
              coordinates[index] = coord
              return { ...route, geometry: { type: 'LineString', coordinates } }
            })
            return
          }
          updateInfra(key, (entity) => {
            if (entity.geometry.type !== 'LineString') {
              return entity
            }
            const coordinates = entity.geometry.coordinates.slice()
            coordinates[index] = coord
            return { ...entity, geometry: { type: 'LineString', coordinates } }
          })
        }}
        onMovePoint={(key, coord) =>
          updateInfra(key, (entity) =>
            entity.geometry.type === 'Point' ? { ...entity, geometry: { type: 'Point', coordinates: coord } } : entity,
          )
        }
        onViewportChange={setViewport}
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
          if (draft.layer === 'route' && draft.mode === 'bus' && selectedRouteId) {
            updateRoute(selectedRouteId, (route) => route.geometry
              ? { ...route, geometry: { type: 'LineString', coordinates: route.geometry.coordinates.slice(0, -1) } }
              : route)
            return
          }
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
          if (draft.layer === 'route' && draft.mode === 'bus' && selectedRouteId) {
            updateRoute(selectedRouteId, (route) => route.geometry
              ? { ...route, geometry: { type: 'LineString', coordinates: [...route.geometry.coordinates].reverse() } }
              : route)
            return
          }
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
          if (draft.mode === 'bus') setTool('route')
          const route = draft.routes.find((item) => item.id === id)
          if (route?.since) {
            setDrawSince(route.since)
          }
          setDrawUntil(route?.until ?? '')
        }}
        onChangeRoute={(id, patch) => {
          const number = patch.number !== undefined ? patch.number.trim() || '1' : undefined
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
                }
              }),
            }
          })
        }}
        onAddRoute={() => {
          const number = drawNumber.trim() || '1'
          const id = newRouteId(draft.mode)
          const route: RouteEntity = {
            id,
            mode: draft.mode,
            number,
            name: `${t('studio.route')} №${number}`,
            color: MODE_COLORS[draft.mode],
            segmentIds: [],
            geometry: draft.mode === 'bus' ? { type: 'LineString', coordinates: [] } : undefined,
            since: drawSince,
            until: drawUntil || undefined,
          }
          setDraft((current) => (current ? { ...current, routes: [...current.routes, route] } : current))
          setSelectedRouteId(id)
          if (draft.mode === 'bus') setTool('route')
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
        canSubmit={Boolean(changeSetId) && !dirty}
        onSubmit={() => void submitForReview()}
        onLogout={() => void logout()}
      />
    </div>
  )
}
