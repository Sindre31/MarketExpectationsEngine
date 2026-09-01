import React from 'react';

/**
 * Without this, one malformed field in a live payload unmounts the whole tree
 * and a visitor gets a blank white page with no way back. A crash here is a
 * data problem far more often than a code problem, so the fallback offers the
 * two things that actually recover it: pick a different company, or clear the
 * cached state this browser is holding.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Market Expectations Engine crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const box: React.CSSProperties = {
      background: 'var(--sur)', border: '1px solid var(--bor)', borderRadius: 5,
      padding: '22px 24px', maxWidth: 560, margin: '10vh auto', fontFamily: "'IBM Plex Sans',sans-serif",
      color: 'var(--ink)',
    };
    const btn: React.CSSProperties = {
      background: 'none', border: '1px solid var(--bor2)', color: 'var(--acc)', borderRadius: 3,
      padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: "'IBM Plex Sans',sans-serif",
    };
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: 20 }}>
        <div style={box}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Something in this view failed to render</div>
          <div style={{ fontSize: 12.5, color: 'var(--mut)', marginBottom: 14 }}>
            This is usually a company whose filings are shaped differently from what the model expects,
            rather than a problem with your browser. Reloading on the built-in dataset almost always works.
          </div>
          <pre style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: 'var(--neg)', background: 'var(--bg)', padding: '8px 10px', borderRadius: 4, overflowX: 'auto', margin: '0 0 14px' }}>
            {error.message}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} onClick={() => window.location.reload()}>Reload</button>
            <button
              style={btn}
              onClick={() => {
                try {
                  localStorage.removeItem('mee_peers');
                  localStorage.removeItem('mee_presets');
                } catch {
                  /* nothing more we can do */
                }
                window.location.reload();
              }}
            >
              Clear saved state and reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
