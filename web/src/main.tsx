import '@fontsource/atkinson-hyperlegible/latin-400.css'
import '@fontsource/atkinson-hyperlegible/latin-700.css'
import './styles.css'

import { Analytics } from '@vercel/analytics/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Vercel Analytics: page views only (cookieless), sent without the query string.
        Custom events go to Umami via src/analytics.ts. */}
    <Analytics beforeSend={(e) => ({ ...e, url: e.url.split('?')[0]! })} />
  </StrictMode>,
)
