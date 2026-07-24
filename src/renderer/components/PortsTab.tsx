import { useCallback, useEffect, useRef, useState } from 'react'
import type { PortInfo } from '../types'

interface Props {
  addToast: (msg: string, type: 'success' | 'error') => void
}

type Filter = 'all' | 'node' | 'java'

const REFRESH_MS = 3000

export function PortsTab({ addToast }: Props) {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [busyPid, setBusyPid] = useState<number | null>(null)
  // Avoid overlapping loads (a slow netstat while the interval fires again)
  const inFlight = useRef(false)

  const load = useCallback(async (showSpinner = false) => {
    if (inFlight.current) return
    inFlight.current = true
    if (showSpinner) setLoading(true)
    try {
      const list = await window.portvm.listPorts()
      setPorts(list)
    } catch {
      addToast('Failed to read ports', 'error')
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [addToast])

  // Initial load
  useEffect(() => {
    load(true)
  }, [load])

  // Auto-refresh polling
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => load(false), REFRESH_MS)
    return () => clearInterval(id)
  }, [autoRefresh, load])

  const handleKill = async (p: PortInfo) => {
    if (!confirm(`Kill ${p.processName} (PID ${p.pid}) listening on port ${p.port}?`)) return
    setBusyPid(p.pid)
    const res = await window.portvm.killPort(p.pid)
    setBusyPid(null)
    if (res.success) {
      addToast(`Killed PID ${p.pid} (port ${p.port})`, 'success')
      load(false)
    } else {
      addToast(res.error ?? 'Failed to kill process', 'error')
    }
  }

  const visible = ports.filter((p) => filter === 'all' || p.runtime === filter)

  return (
    <div>
      <div className="ports-toolbar">
        <div className="tool-switch">
          {(['all', 'node', 'java'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`tool-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'node' ? 'Node' : 'Java'}
            </button>
          ))}
        </div>
        <div className="ports-toolbar-right">
          <label className="ports-autorefresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (3s)
          </label>
          <button className="btn btn-outline" onClick={() => load(true)}>
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading...
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🔌</div>
          No {filter === 'all' ? 'Node or Java' : filter === 'node' ? 'Node' : 'Java'} processes are
          listening on any port.
        </div>
      ) : (
        <div className="version-list">
          {visible.map((p) => (
            <div key={`${p.pid}:${p.port}`} className="version-card">
              <div className="version-info">
                <div className="version-name">
                  :{p.port}
                  <span className={`version-badge ${p.runtime}`} style={{ marginLeft: 8 }}>
                    {p.runtime === 'node' ? '⬡ Node' : '☕ Java'}
                  </span>
                </div>
                <div className="version-meta">
                  PID {p.pid} · {p.processName} · {p.address} · {p.protocol}
                </div>
              </div>
              <div className="version-actions">
                <button
                  className="btn btn-danger"
                  disabled={busyPid === p.pid}
                  onClick={() => handleKill(p)}
                >
                  {busyPid === p.pid ? 'Killing…' : 'Kill'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
