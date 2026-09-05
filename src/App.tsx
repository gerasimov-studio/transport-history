import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { EditorPage } from './pages/EditorPage'
import { ViewerPage } from './pages/ViewerPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ViewerPage />} />
        <Route path="/edit" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  )
}
