import { useEffect, useState } from 'react'
import type { InstalledVersion } from '../types'

interface Props {
  refreshKey: number
  currentVersion: string | null
  onRefresh: () => void
  addToast: (msg: string, type: 'success' | 'error') => void
}

export function InstalledTab({ refreshKey, currentVersion, onRefresh, addToast }: Props) {
  const [versions, setVersions] = useState<InstalledVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [busyVersion, setBusyVersion] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    window.nodevm.listInstalled().then((list) => {
      setVersions(list)
      setLoading(false)
    })
  }, [refreshKey])

  const handleUse = async (version: string) => {
    setBusyVersion(version)
    const res = await window.nodevm.use(version)
    setBusyVersion(null)
    if (res.success) {
      addToast(`Switched to ${version}. Restart your terminal to apply.`, 'success')
      onRefresh()
    } else {
      addToast(res.error ?? 'Failed to switch version', 'error')
    }
  }

  const handleUninstall = async (version: string) => {
    if (!confirm(`Uninstall Node ${version}?`)) return
    setBusyVersion(version)
    const res = await window.nodevm.uninstall(version)
    setBusyVersion(null)
    if (res.success) {
      addToast(`${version} uninstalled`, 'success')
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
        <div key={v.version} className={`version-card ${v.isCurrent ? 'current' : ''}`}>
          <div className="version-info">
            <div className="version-name">{v.version}</div>
            {v.isCurrent && <div className="version-badge">● active</div>}
          </div>
          <div className="version-actions">
            {!v.isCurrent && (
              <button
                className="btn btn-primary"
                disabled={busyVersion === v.version}
                onClick={() => handleUse(v.version)}
              >
                {busyVersion === v.version ? 'Switching…' : 'Use'}
              </button>
            )}
            {!v.isCurrent && (
              <button
                className="btn btn-danger"
                disabled={busyVersion === v.version}
                onClick={() => handleUninstall(v.version)}
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
