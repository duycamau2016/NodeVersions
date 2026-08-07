import { useEffect, useState } from 'react'
import type { InstalledVersion, VmApi } from '../types'

interface Props {
  api: VmApi
  noun: string
  refreshKey: number
  onRefresh: () => void
  addToast: (msg: string, type: 'success' | 'error') => void
}

export function InstalledTab({ api, noun, refreshKey, onRefresh, addToast }: Props) {
  const [versions, setVersions] = useState<InstalledVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [busyPath, setBusyPath] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.listInstalled().then((list) => {
      setVersions(list)
      setLoading(false)
    })
  }, [api, refreshKey])

  const handleUse = async (v: InstalledVersion) => {
    setBusyPath(v.path)
    const res = await api.use(v.path)
    setBusyPath(null)
    if (res.success) {
      addToast(`Switched to ${v.version}. Restart your terminal to apply.`, 'success')
      onRefresh()
    } else {
      addToast(res.error ?? 'Failed to switch version', 'error')
    }
  }

  const handleUninstall = async (v: InstalledVersion) => {
    if (!confirm(`Uninstall ${noun} ${v.version}?`)) return
    setBusyPath(v.path)
    const res = await api.uninstall(v.version)
    setBusyPath(null)
    if (res.success) {
      addToast(`${v.version} uninstalled`, 'success')
      onRefresh()
    } else {
      addToast(res.error ?? 'Failed to uninstall', 'error')
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading...
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">📦</div>
        No versions installed yet. Go to <strong>Install New</strong> tab to get started.
      </div>
    )
  }

  return (
    <div className="version-list">
      {versions.map((v) => (
        <div key={v.path} className={`version-card ${v.isCurrent ? 'current' : ''}`}>
          <div className="version-info">
            <div className="version-name">{v.version}</div>
            {v.isCurrent && <div className="version-badge">● active</div>}
            {v.external && (
              <div
                className="version-badge system"
                title={
                  v.origin === 'nvm'
                    ? "Installed by nvm — listed here, but never modified by this app"
                    : "Detected on this machine — won't be removed by this app"
                }
              >
                {v.origin === 'nvm' ? 'nvm' : 'system'}
              </div>
            )}
            {v.originActive && (
              <div className="version-badge system" title="The version nvm itself currently has selected">
                nvm current
              </div>
            )}
            {v.external && <div className="version-meta">{v.path}</div>}
          </div>
          <div className="version-actions">
            {!v.isCurrent && (
              <button
                className="btn btn-primary"
                disabled={busyPath === v.path}
                onClick={() => handleUse(v)}
              >
                {busyPath === v.path ? 'Switching…' : 'Use'}
              </button>
            )}
            {!v.external && !v.isCurrent && (
              <button
                className="btn btn-danger"
                disabled={busyPath === v.path}
                onClick={() => handleUninstall(v)}
              >
                Uninstall
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
