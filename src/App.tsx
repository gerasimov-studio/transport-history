import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { EditorPage } from './pages/EditorPage'
import { ViewerPage } from './pages/ViewerPage'
import { AccountPage } from './pages/AccountPage'
import { RegisterPage } from './pages/RegisterPage'
import { AdminUsersPage } from './pages/AdminUsersPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ViewerPage />} />
        <Route path="/edit" element={<EditorPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/moderation" element={<AccountPage />} />
      </Routes>
    </BrowserRouter>
  )
}
