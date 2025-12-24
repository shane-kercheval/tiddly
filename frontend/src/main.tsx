import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode disabled for testing - re-enable after verifying fix
createRoot(document.getElementById('root')!).render(
  // <StrictMode>
    <App />,
  // </StrictMode>,
)
