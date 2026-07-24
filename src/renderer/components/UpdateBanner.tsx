import { useEffect, useState } from 'react'

type State =
  | { kind: 'hidden' }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string }

export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: 'hidden' })

  useEffect(() => {
    const u = window.updatevm
    u.onAvailable((version) => setState({ kind: 'downloading', version, percent: 0 }))
    u.onProgress((percent) =>
      setState((s) => (s.kind === 'downloading' ? { ...s, percent } : s)))
    u.onDownloaded((version) => setState({ kind: 'ready', version }))
    u.onError((message) => setState({ kind: 'error', message }))
    return () => u.removeListeners()
  }, [])

  if (state.kind === 'hidden') return null

  return (
    <div className={`update-banner ${state.kind === 'error' ? 'error' : ''}`}>
      {state.kind === 'downloading' && (
        <>
          <span>⬇ Downloading update v{state.version}… {state.percent}%</span>
          <div className="update-progress">
            <div className="update-progress-bar" style={{ width: `${state.percent}%` }} />
          </div>
        </>
      )}
      {state.kind === 'ready' && (
        <>
          <span>✅ Update v{state.version} ready.</span>
          <button className="btn btn-primary" onClick={() => window.updatevm.install()}>
            Restart &amp; Update
          </button>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <span>⚠ Update failed: {state.message}</span>
          <button className="btn btn-outline" onClick={() => setState({ kind: 'hidden' })}>
            Dismiss
          </button>
        </>
      )}
    </div>
  )
}
