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
    {/* Cookieless. Page views are sent without the query string: the check itself
        (district, item, price) only goes out as the price_checked event's coarse fields. */}
    <Analytics beforeSend={(e) => ({ ...e, url: e.url.split('?')[0]! })} />
  </StrictMode>,
)
