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
  const { user, loading } = useSession()
  const { locale, setLocale, t } = useI18n()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [changesets, setChangesets] = useState<ChangeSet[]>([])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState<string | null>(null)

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

  if (loading) return <p className="app-status">{t('loading')}</p>
  if (!user) return <main className="workspace-page"><h1>{t('account.title')}</h1><p>{t('account.login')} <Link to="/edit">{t('editor')}</Link></p></main>

  return (
    <main className="workspace-page">
      <nav className="workspace-nav"><Link to="/">{t('map')}</Link><Link to="/edit">{t('editor')}</Link></nav>
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
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}
