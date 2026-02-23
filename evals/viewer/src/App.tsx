import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import RunsList from './components/RunsList'
import RunDetail from './components/RunDetail'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-2">
          <Link to="/" className="text-sm font-semibold text-gray-900 hover:text-gray-700 tracking-wide uppercase">
            Eval Results
          </Link>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-4">
          <Routes>
            <Route path="/" element={<RunsList />} />
            <Route path="/runs/:evaluationId" element={<RunDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
