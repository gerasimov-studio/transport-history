import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { api } from '../lib/api'

export function RegisterPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function register(event: FormEvent) {
    event.preventDefault()
    try {
      await api('/api/register', { method: 'POST', body: JSON.stringify({ username, password }) })
      navigate('/account', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('account.error'))
    }
  }

  return <main className="workspace-page">
    <nav className="workspace-nav"><Link to="/">{t('map')}</Link><Link to="/account">{t('account.haveAccount')}</Link></nav>
    <h1>{t('account.register')}</h1>
    {error ? <p className="studio-message">{error}</p> : null}
    <form className="workspace-card workspace-form" onSubmit={register}>
      <label className="studio-field">{t('login.username')}<input required minLength={3} maxLength={32} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
      <label className="studio-field">{t('login.password')}<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={t('account.passwordHint')} /></label>
      <button className="studio-btn studio-btn--primary">{t('account.register')}</button>
    </form>
  </main>
}
