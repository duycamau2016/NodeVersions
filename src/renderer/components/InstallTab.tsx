import { useEffect, useState } from 'react'
import type { RemoteVersion, InstalledVersion, VmApi } from '../types'

interface Props {
  api: VmApi
  sourceLabel: string
  onInstalled: () => void
  addToast: (msg: string, type: 'success' | 'error') => void
}

export function InstallTab({ api, sourceLabel, onInstalled, addToast }: Props) {
  const [remote, setRemote] = useState<RemoteVersion[]>([])
  const [installed, setInstalled] = useState<InstalledVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.listRemote(), api.listInstalled()]).then(([r, i]) => {
      setRemote(r)
      setInstalled(i)
      setLoading(false)
    })

    api.onInstallProgress(({ progress: p }) => setProgress(p))
    return () => api.removeInstallProgressListener()
  }, [api])

  const isInstalled = (version: string) => installed.some((v) => v.version === version)

  const handleInstall = async (version: string) => {
    setInstalling(version)
    setProgress(0)
    const res = await api.install(version)
    setInstalling(null)
    setProgress(0)
    if (res.success) {
      addToast(`${version} installed successfully!`, 'success')
      api.listInstalled().then(setInstalled)
      onInstalled()
    } else {
      addToast(res.error ?? `Failed to install ${version}`, 'error')
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Fetching versions from {sourceLabel}…
      </div>
    )
  }

  return (
    <div className="version-list">
      {remote.map((v) => {
        const done = isInstalled(v.version)
        const busy = installing === v.version
        return (
          <div key={v.version} className="version-card">
            <div className="version-info">
              <div className="version-name">{v.version}</div>
              {v.lts && <div className="version-badge lts">LTS · {v.lts}</div>}
              <div className="version-meta">{v.date}</div>
              {busy && (
                <div className="progress-wrap">
                  <div className="progress-bar" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
            <div className="version-actions">
              {done ? (
                <span className="version-badge">Installed</span>
              ) : (
                <button
                  className="btn btn-primary"
                  disabled={!!installing}
                  onClick={() => handleInstall(v.version)}
                >
                  {busy ? `${progress}%` : 'Install'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
