import { useState, useEffect, useCallback } from 'react'
import { InstalledTab } from './components/InstalledTab'
import { InstallTab } from './components/InstallTab'
import { SettingsTab } from './components/SettingsTab'
import { ToastContainer, type Toast } from './components/Toast'

export default function App() {
  const [tab, setTab] = useState<'installed' | 'install' | 'settings'>('installed')
  const [current, setCurrent] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
    window.nodevm.getCurrent().then(setCurrent)
  }, [])

  useEffect(() => {
    window.nodevm.getCurrent().then(setCurrent)
  }, [])

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500)
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>⬡ Node Version Manager</h1>
        <div className="header-current">
          Active:{' '}
          <span>{current ?? 'none'}</span>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
          Installed
        </button>
        <button className={`tab ${tab === 'install' ? 'active' : ''}`} onClick={() => setTab('install')}>
          Install New
        </button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          Settings / Help
        </button>
      </nav>

      <main className="content">
        {tab === 'installed' && (
          <InstalledTab refreshKey={refreshKey} currentVersion={current} onRefresh={refresh} addToast={addToast} />
        )}
        {tab === 'install' && <InstallTab onInstalled={refresh} addToast={addToast} />}
        {tab === 'settings' && <SettingsTab />}
      </main>

      <ToastContainer toasts={toasts} />
    </div>
  )
}
