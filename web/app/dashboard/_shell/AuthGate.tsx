// Minimal OTP sign-in splash. Posts { email } to /api/auth/login to
// receive an OTP, then posts { email, code } to /api/auth/verify which
// sets the HttpOnly session cookie and responds with the user object.
// On success we reload — the DashboardProvider picks up the new session.

'use client';

import { useState } from 'react';
import { Button } from '../_ui/Button';
import { Input } from '../_ui/Input';
import { Wordmark } from '@/app/components/Wordmark';

export function AuthGate() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('failed to send code');
      setStage('code');
    } catch (err) {
      setError((err as Error).message || 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) throw new Error('invalid code');
      window.location.reload();
    } catch (err) {
      setError((err as Error).message || 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--surface-2)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 20,
          padding: '2.25rem 2rem 2rem',
          boxShadow: 'var(--shadow-hero)',
        }}
      >
        <div
          style={{
            marginBottom: '0.6rem',
            color: 'var(--fg)',
          }}
        >
          <Wordmark height={30} />
        </div>
        <div
          style={{
            fontSize: '0.95rem',
            color: 'var(--fg-muted)',
            letterSpacing: '-0.01em',
            marginBottom: '1.75rem',
          }}
        >
          Sign in to your operator dashboard
        </div>

        {stage === 'email' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && email) sendCode();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}
          >
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !email}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && code.length >= 6) verifyCode();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}
          >
            <div style={{ fontSize: '0.85rem', color: 'var(--fg-muted)' }}>
              Code sent to <strong style={{ color: 'var(--fg)' }}>{email}</strong>
            </div>
            <Input
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              disabled={busy || code.length < 6}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {busy ? 'Verifying…' : 'Sign in'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStage('email');
                setCode('');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--blue)',
                fontSize: '0.82rem',
                cursor: 'pointer',
                marginTop: '0.25rem',
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        {error && (
          <div
            style={{
              marginTop: '0.85rem',
              fontSize: '0.82rem',
              color: 'var(--red)',
              padding: '0.6rem 0.8rem',
              background: 'var(--red-muted)',
              border: '1px solid var(--red-border)',
              borderRadius: 10,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
