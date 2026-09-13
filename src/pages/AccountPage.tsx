/* oxlint-disable react/set-state-in-effect -- server session drives page data */
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../data/useSession'
import { api } from '../lib/api'
import { LOCALES, useI18n, type Locale } from '../i18n'

type Workspace = {
  id: string
  kind: 'canonical' | 'scenario'
  title: string
  description: string
  visibility: 'private' | 'link' | 'public'
}

type ChangeSet = {
  id: string
  workspaceId: string
  status: string
  date: string
  mode: string
  title: string
  summary: string
  author: string
  canModerate: boolean
  updatedAt: string
}

export function AccountPage() {
  const { user, loading, setUser } = useSession()
  const { locale, setLocale, t } = useI18n()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [changesets, setChangesets] = useState<ChangeSet[]>([])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [authName, setAuthName] = useState('')
  const [authPassword, setAuthPassword] = useState('')

  async function reload() {
    const [spaces, changes] = await Promise.all([
      api<{ workspaces: Workspace[] }>('/api/workspaces'),
      api<{ changesets: ChangeSet[] }>('/api/changesets'),
    ])
    setWorkspaces(spaces.workspaces)
    setChangesets(changes.changesets)
  }

  // The effect synchronizes this page with the authenticated server session.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    if (user) void reload().catch((cause) => setMessage(cause instanceof Error ? cause.message : t('account.error')))
  }, [user])

  async function createScenario(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    await api('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), visibility: 'private' }),
    })
    setTitle('')
    await reload()
  }

  async function publish(id: string) {
    try {
      await api(`/api/changesets/${encodeURIComponent(id)}/publish`, { method: 'POST' })
      setMessage(t('account.published'))
      await reload()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('account.publishError'))
    }
  }

  async function authenticate(event: FormEvent) {
    event.preventDefault()
    try {
      const body = await api<{ user: NonNullable<typeof user> }>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username: authName, password: authPassword }),
      })
      setUser(body.user)
      setMessage(null)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('account.error'))
    }
  }

  async function review(id: string, decision: 'changes_requested' | 'rejected') {
    await api(`/api/changesets/${encodeURIComponent(id)}/review`, {
      method: 'POST', body: JSON.stringify({ decision }),
    })
    await reload()
  }

  if (loading) return <p className="app-status">{t('loading')}</p>
  if (!user) return (
    <main className="workspace-page">
      <h1>{t('account.title')}</h1>
      {message ? <p className="studio-message">{message}</p> : null}
      <form className="workspace-card workspace-form" onSubmit={authenticate}>
        <label className="studio-field">{t('login.username')}<input value={authName} onChange={(event) => setAuthName(event.target.value)} autoComplete="username" /></label>
        <label className="studio-field">{t('login.password')}<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete="current-password" /></label>
        <button className="studio-btn studio-btn--primary">{t('login.submit')}</button>
        <Link className="studio-btn" to="/register">{t('account.register')}</Link>
      </form>
    </main>
  )

  return (
    <main className="workspace-page">
      <nav className="workspace-nav"><Link to="/">{t('map')}</Link><Link to="/edit">{t('editor')}</Link>{user.role === 'superuser' ? <Link to="/admin/users">{t('account.admin')}</Link> : null}</nav>
      <header><p className="brand__kicker">{t('account.kicker')}</p><h1>{user.username}</h1></header>
      <label className="workspace-language">
        <span>{t('language')}</span>
        <select value={locale} onChange={(event) => void setLocale(event.target.value as Locale, true)}>
          {LOCALES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {message ? <p className="studio-message">{message}</p> : null}
      <section className="workspace-card">
        <h2>{t('account.maps')}</h2>
        <div className="workspace-grid">
          {workspaces.map((space) => (
            <article key={space.id} className="workspace-item">
              <span>{space.kind === 'canonical' ? t('account.main') : `${t('account.scenario')} · ${space.visibility}`}</span>
              <h3>{space.title}</h3>
              <Link to={`/edit?workspace=${encodeURIComponent(space.id)}`}>{t('account.open')}</Link>
              {space.kind === 'scenario' ? <> · <Link to={`/?workspace=${encodeURIComponent(space.id)}`}>{t('account.view')}</Link></> : null}
            </article>
          ))}
        </div>
        <form className="workspace-form" onSubmit={createScenario}>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('account.scenarioName')} />
          <button className="studio-btn studio-btn--primary">{t('account.create')}</button>
        </form>
      </section>
      <section className="workspace-card">
        <h2>{t('account.changes')}</h2>
        <div className="workspace-grid">
          {changesets.filter((change) => change.author === user.username).map((change) => (
            <article key={change.id} className="workspace-item">
              <span>{change.status} · {change.mode} · {change.date}</span>
              <h3>{change.title || t('account.noTitle')}</h3>
              <small>{new Date(change.updatedAt).toLocaleString(locale)}</small>
            </article>
          ))}
        </div>
      </section>
      {changesets.some((change) => change.status === 'submitted' && change.canModerate) ? (
        <section className="workspace-card">
          <h2>{t('account.moderation')}</h2>
          <div className="workspace-grid">
            {changesets.filter((change) => change.status === 'submitted' && change.canModerate).map((change) => (
              <article key={change.id} className="workspace-item">
                <span>{change.author} · {change.mode} · {change.date}</span>
                <h3>{change.title || t('account.networkChanges')}</h3>
                <p>{change.summary || t('account.noDescription')}</p>
                <button className="studio-btn studio-btn--primary" onClick={() => void publish(change.id)}>{t('account.publish')}</button>
                <button className="studio-btn" onClick={() => void review(change.id, 'changes_requested')}>{t('account.requestChanges')}</button>
                <button className="studio-btn studio-btn--danger" onClick={() => void review(change.id, 'rejected')}>{t('account.reject')}</button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}
