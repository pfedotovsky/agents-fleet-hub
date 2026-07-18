import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './index.css'
import App from './App.tsx'
import { BacklogPage } from './components/BacklogPage.tsx'

// Dev-only full-page Backlog view, opened in its own tab via `?view=backlog`.
// The guard is import.meta.env.DEV so `vite build` tree-shakes both the branch
// and the BacklogPage import out of the release bundle.
const isBacklogView =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('view') === 'backlog'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {isBacklogView ? <BacklogPage /> : <App />}
    </MotionConfig>
  </StrictMode>,
)
