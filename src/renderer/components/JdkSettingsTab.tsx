import { useEffect, useState } from 'react'

export function JdkSettingsTab() {
  const [envOk, setEnvOk] = useState<boolean | null>(null)
  const [profileOk, setProfileOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.jdkvm.checkEnv().then(setEnvOk)
    window.jdkvm.checkProfile().then(setProfileOk)
  }, [])

  const handleSetupEnv = async () => {
    setBusy(true)
    const res = await window.jdkvm.setupEnv()
    setBusy(false)
    if (res.success) setEnvOk(true)
    else alert('Failed: ' + res.error)
  }

  const handleSetupProfile = async () => {
    setBusy(true)
    const res = await window.jdkvm.setupProfile()
    setBusy(false)
    if (res.success) setProfileOk(true)
    else alert('Failed: ' + res.error)
  }

  const allDone = envOk && profileOk

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Overall status */}
      {allDone && (
        <div className="path-hint" style={{ borderColor: 'var(--accent)' }}>
          <span style={{ color: 'var(--accent)' }}>
            ✓ All configured. Open a new terminal and run <code>java -version</code> to verify.
          </span>
        </div>
      )}

      {/* Step 1: JAVA_HOME + User PATH */}
      <div className="path-hint" style={{ borderColor: envOk ? 'var(--accent)' : 'var(--warning)' }}>
        <strong style={{ color: 'var(--text)' }}>Step 1 — JAVA_HOME + User PATH</strong>
        <br /><br />
        {envOk === null && <span style={{ color: 'var(--text-muted)' }}>Checking...</span>}
        {envOk === true
          ? <span style={{ color: 'var(--accent)' }}>✓ Done</span>
          : envOk === false && (
            <>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '10px' }}>
                Sets <code>JAVA_HOME</code> to <code>~\.jdkvm\current</code> and adds
                <code>~\.jdkvm\current\bin</code> to User PATH (registry). Maven, Gradle and IDEs
                read <code>JAVA_HOME</code>, so switching versions just re-points the junction —
                no need to edit env again.
              </p>
              <button className="btn btn-primary" disabled={busy} onClick={handleSetupEnv}>
                {busy ? 'Working...' : 'Configure JAVA_HOME + PATH'}
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
                Windows puts System PATH before User PATH, so an existing Java install always wins.
                This step injects two lines into your PowerShell profile so <code>JAVA_HOME</code> and
                <code>~\.jdkvm\current\bin</code> are always set when a terminal opens — no admin needed.
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
        JDKs are stored in <code>%USERPROFILE%\.jdkvm\versions\</code>.
        Switching creates a directory junction at <code>%USERPROFILE%\.jdkvm\current\</code> — no admin needed.
        Builds are Eclipse Temurin (Adoptium).
      </div>

      <button className="btn btn-outline" style={{ width: 'fit-content' }} onClick={() => window.jdkvm.openInstallDir()}>
        Open JDK folder
      </button>
    </div>
  )
}
