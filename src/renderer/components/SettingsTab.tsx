import { useEffect, useState } from 'react'

const IS_WIN = window.platform?.os === 'win32'

export function SettingsTab() {
  const [pathOk, setPathOk] = useState<boolean | null>(null)
  const [profileOk, setProfileOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.nodevm.checkPath().then(setPathOk)
    window.nodevm.checkProfile().then(setProfileOk)
  }, [])

  const handleSetupPath = async () => {
    setBusy(true)
    const res = await window.nodevm.setupPath()
    setBusy(false)
    if (res.success) setPathOk(true)
    else alert('Failed: ' + res.error)
  }

  const handleSetupProfile = async () => {
    setBusy(true)
    const res = await window.nodevm.setupProfile()
    setBusy(false)
    if (res.success) setProfileOk(true)
    else alert('Failed: ' + res.error)
  }

  const allDone = pathOk && profileOk

  if (!IS_WIN) {
    // macOS/Linux: PATH lives in a single shell profile (~/.zshrc)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="path-hint" style={{ borderColor: profileOk ? 'var(--accent)' : 'var(--warning)' }}>
          <strong style={{ color: 'var(--text)' }}>Shell PATH</strong>
          <br /><br />
          {profileOk === null && <span style={{ color: 'var(--text-muted)' }}>Checking...</span>}
          {profileOk === true
            ? <span style={{ color: 'var(--accent)' }}>✓ Configured. Open a new terminal and run <code>node --version</code> to verify.</span>
            : profileOk === false && (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '10px' }}>
                  Adds <code>export PATH="$HOME/.nodevm/current/bin:$PATH"</code> to your <code>~/.zshrc</code>
                  so the active version is always on PATH when a terminal opens.
                </p>
                <button className="btn btn-primary" disabled={busy} onClick={handleSetupProfile}>
                  {busy ? 'Working...' : 'Configure shell PATH'}
                </button>
              </>
            )}
        </div>

        <div className="path-hint">
          <strong style={{ color: 'var(--text)' }}>How it works</strong>
          <br />
          Versions are stored in <code>~/.nodevm/versions/</code>.
          Switching re-points a symlink at <code>~/.nodevm/current/</code> — no admin needed.
        </div>

        <button className="btn btn-outline" style={{ width: 'fit-content' }} onClick={() => window.nodevm.openInstallDir()}>
          Open versions folder
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Overall status */}
      {allDone && (
        <div className="path-hint" style={{ borderColor: 'var(--accent)' }}>
          <span style={{ color: 'var(--accent)' }}>
            ✓ All configured. Open a new terminal and run <code>node --version</code> to verify.
          </span>
        </div>
      )}

      {/* Step 1: User PATH */}
      <div className="path-hint" style={{ borderColor: pathOk ? 'var(--accent)' : 'var(--warning)' }}>
        <strong style={{ color: 'var(--text)' }}>Step 1 — User PATH</strong>
        <br /><br />
        {pathOk === null && <span style={{ color: 'var(--text-muted)' }}>Checking...</span>}
        {pathOk === true
          ? <span style={{ color: 'var(--accent)' }}>✓ Done</span>
          : pathOk === false && (
            <>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '10px' }}>
                Adds <code>~\.nodevm\current</code> to User PATH (registry).
              </p>
              <button className="btn btn-primary" disabled={busy} onClick={handleSetupPath}>
                {busy ? 'Working...' : 'Configure User PATH'}
              </button>
            </>
          )}
      </div>

      {/* Step 2: PowerShell profile (fixes Machine PATH priority issue) */}
      <div className="path-hint" style={{ borderColor: profileOk ? 'var(--accent)' : 'var(--warning)' }}>
        <strong style={{ color: 'var(--text)' }}>Step 2 — PowerShell Profile <span style={{ color: 'var(--warning)', fontWeight: 400, fontSize: '11px' }}>(required)</span></strong>
        <br /><br />
        {profileOk === null && <span style={{ color: 'var(--text-muted)' }}>Checking...</span>}
        {profileOk === true
          ? <span style={{ color: 'var(--accent)' }}>✓ Done</span>
          : profileOk === false && (
            <>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '10px' }}>
                Windows puts System PATH before User PATH, so <code>C:\Program Files\nodejs</code> always wins.
                This step injects one line into your PowerShell profile so <code>~\.nodevm\current</code>
                is always prepended when a terminal opens — no admin needed.
              </p>
              <button className="btn btn-primary" disabled={busy} onClick={handleSetupProfile}>
                {busy ? 'Working...' : 'Configure PowerShell Profile'}
              </button>
            </>
          )}
      </div>

      <div className="path-hint">
        <strong style={{ color: 'var(--text)' }}>How it works</strong>
        <br />
        Versions are stored in <code>%USERPROFILE%\.nodevm\versions\</code>.
        Switching creates a directory junction at <code>%USERPROFILE%\.nodevm\current\</code> — no admin needed.
      </div>

      <button className="btn btn-outline" style={{ width: 'fit-content' }} onClick={() => window.nodevm.openInstallDir()}>
        Open versions folder
      </button>
    </div>
  )
}
