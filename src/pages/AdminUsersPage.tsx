import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../data/useSession'
import { useI18n } from '../i18n'
import { api } from '../lib/api'

type AccountUser = { id: number; username: string; role: 'user' | 'moderator' | 'superuser' }

export function AdminUsersPage() {
  const { user, loading } = useSession()
  const { t } = useI18n()
  const [users, setUsers] = useState<AccountUser[]>([])
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setUsers((await api<{ users: AccountUser[] }>('/api/users')).users)
  }

  useEffect(() => {
    if (user?.role === 'superuser') void reload().catch((cause) => setError(cause instanceof Error ? cause.message : t('account.error')))
  }, [user])

  async function setRole(id: number, role: 'user' | 'moderator') {
    await api(`/api/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) })
    await reload()
  }

  if (loading) return <p className="app-status">{t('loading')}</p>
  if (user?.role !== 'superuser') return <main className="workspace-page"><h1>403</h1><Link to="/account">{t('account.back')}</Link></main>

  return <main className="workspace-page">
    <nav className="workspace-nav"><Link to="/account">{t('account.back')}</Link></nav>
    <h1>{t('account.admin')}</h1>
    {error ? <p className="studio-message">{error}</p> : null}
    <section className="workspace-card"><div className="workspace-grid">
      {users.map((item) => <article key={item.id} className="workspace-item">
        <h3>{item.username}</h3>
        {item.role === 'superuser' ? <span>{t('account.superuser')}</span> : <label className="studio-field">{t('account.role')}
          <select value={item.role} onChange={(event) => void setRole(item.id, event.target.value as 'user' | 'moderator')}>
            <option value="user">{t('account.user')}</option><option value="moderator">{t('account.moderator')}</option>
          </select>
        </label>}
      </article>)}
    </div></section>
  </main>
}
