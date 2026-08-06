// Webview entry point — the VS Code counterpart of src/renderer/main.tsx.
//
// IMPORT ORDER IS LOAD-BEARING: './bridge' must come first so window.platform /
// window.nodevm exist before App's module graph evaluates (SettingsTab reads
// window.platform at module scope). Do not let a formatter sort these.
import './bridge'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../../src/renderer/App'
import '../../src/renderer/index.css'
import './webview.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
