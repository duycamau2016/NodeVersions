import { useState, useEffect, useCallback } from 'react'
import { InstalledTab } from './components/InstalledTab'
import { InstallTab } from './components/InstallTab'
import { SettingsTab } from './components/SettingsTab'
import { JdkSettingsTab } from './components/JdkSettingsTab'
import { PortsTab } from './components/PortsTab'
import { UpdateBanner } from './components/UpdateBanner'
import { ToastContainer, type Toast } from './components/Toast'

type Tool = 'node' | 'java'
type Tab = 'installed' | 'install' | 'ports' | 'settings'

const TOOLS: Record<Tool, { title: string; noun: string; source: string }> = {
  node: { title: '⬡ Node Version Manager', noun: 'Node', source: 'nodejs.org' },
  java: { title: '☕ JDK Version Manager', noun: 'JDK', source: 'Adoptium' },
}

export default function App() {
  const [tool, setTool] = useState<Tool>('node')
  const [tab, setTab] = useState<Tab>('installed')
  const [current, setCurrent] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  const api = tool === 'node' ? window.nodevm : window.jdkvm
  const meta = TOOLS[tool]

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
    api.getCurrent().then(setCurrent)
  }, [api])

  // Re-read the active version whenever the selected tool changes
  useEffect(() => {
    setCurrent(null)
    api.getCurrent().then(setCurrent)
  }, [api])

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500)
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>{meta.title}</h1>
        <div className="header-right">
          <div className="tool-switch">
            <button
              className={`tool-btn ${tool === 'node' ? 'active' : ''}`}
              onClick={() => setTool('node')}
            >
              Node
            </button>
            <button
              className={`tool-btn ${tool === 'java' ? 'active' : ''}`}
              onClick={() => setTool('java')}
            >
              Java
            </button>
          </div>
          <div className="header-current">
            Active: <span>{current ?? 'none'}</span>
          </div>
        </div>
      </header>

      <UpdateBanner />

      <nav className="tabs">
        <button className={`tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
          Installed
        </button>
        <button className={`tab ${tab === 'install' ? 'active' : ''}`} onClick={() => setTab('install')}>
          Install New
        </button>
        <button className={`tab ${tab === 'ports' ? 'active' : ''}`} onClick={() => setTab('ports')}>
          Ports
        </button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          Settings / Help
        </button>
      </nav>

      <main className="content">
        {tab === 'installed' && (
          <InstalledTab
            key={tool}
            api={api}
            noun={meta.noun}
            refreshKey={refreshKey}
            onRefresh={refresh}
            addToast={addToast}
          />
        )}
        {tab === 'install' && (
          <InstallTab key={tool} api={api} sourceLabel={meta.source} onInstalled={refresh} addToast={addToast} />
        )}
        {tab === 'ports' && <PortsTab addToast={addToast} />}
        {tab === 'settings' && (tool === 'node' ? <SettingsTab /> : <JdkSettingsTab />)}
      </main>

      <ToastContainer toasts={toasts} />
    </div>
  )
}
