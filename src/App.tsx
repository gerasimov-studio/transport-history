import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { EditorPage } from './pages/EditorPage'
import { ViewerPage } from './pages/ViewerPage'
import { AccountPage } from './pages/AccountPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ViewerPage />} />
        <Route path="/edit" element={<EditorPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/moderation" element={<AccountPage />} />
      </Routes>
    </BrowserRouter>
  )
}
