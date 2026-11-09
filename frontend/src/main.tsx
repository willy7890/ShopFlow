import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { queryClient } from './lib/queryClient'
import { applyTheme, useUi } from './store/ui'
import { wireConnectivity } from './offline/sync'
import './index.css'

applyTheme(useUi.getState().theme)
useUi.subscribe((s, p) => { if (s.theme !== p.theme) applyTheme(s.theme) })
useUi.subscribe((s) => { document.documentElement.lang = s.lang })
wireConnectivity()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></React.StrictMode>,
)
