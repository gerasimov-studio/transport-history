import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useI18n } from './i18n'

const ViewerPage = lazy(() => import('./features/history/ViewerPage').then((module) => ({ default: module.ViewerPage })))
const EditorPage = lazy(() => import('./features/editor/EditorPage').then((module) => ({ default: module.EditorPage })))
const AccountPage = lazy(() => import('./features/account/AccountPage').then((module) => ({ default: module.AccountPage })))
const RegisterPage = lazy(() => import('./features/account/RegisterPage').then((module) => ({ default: module.RegisterPage })))
const AdminUsersPage = lazy(() => import('./features/administration/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })))

function RouteFallback() {
  const { t } = useI18n()
  return <p className="app-status">{t('loading')}</p>
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<ViewerPage />} />
          <Route path="/edit" element={<EditorPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/moderation" element={<AccountPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
