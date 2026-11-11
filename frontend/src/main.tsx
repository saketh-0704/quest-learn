import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@astryxdesign/core/reset.css'
import App from './App'
import '@fontsource/baskervville/latin-400.css'
import '@fontsource-variable/source-sans-3/wght.css'
import './features/notebooks/notebooks.css'
import './styles.css'
import './taste-motion.css'
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
