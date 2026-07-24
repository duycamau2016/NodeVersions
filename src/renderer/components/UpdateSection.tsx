import { useEffect, useState } from 'react'

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export function UpdateSection() {
  const [version, setVersion] = useState<string>('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    window.updatevm.getCurrentVersion().then(setVersion)
  }, [])

  const handleCheck = async () => {
    setStatus({ kind: 'checking' })
    const res = await window.updatevm.check()
    if (res.success) setStatus({ kind: 'done' })
    else setStatus({ kind: 'error', message: res.error ?? 'Update check failed' })
  }

  return (
    <div className="path-hint">
      <strong style={{ color: 'var(--text)' }}>App updates</strong>
      <br />
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '8px 0 12px' }}>
        Current version: <code>{version || '…'}</code>
      </p>
      <button className="btn btn-primary" disabled={status.kind === 'checking'} onClick={handleCheck}>
        {status.kind === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>
      {status.kind === 'done' && (
        <p style={{ color: 'var(--accent)', fontSize: '12px', marginTop: '10px' }}>
          ✓ Check complete. If a newer version exists, a banner appears at the top to download it.
        </p>
      )}
      {status.kind === 'error' && (
        <p style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '10px' }}>⚠ {status.message}</p>
      )}
    </div>
  )
}
