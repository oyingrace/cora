// /dashboard/oauth/authorize — completes the MCP connector handshake.
//
// claude.ai sends the browser to the backend's /oauth/authorize, but that route
// can only authenticate an `Authorization: Bearer` header — a browser
// navigation carries cookies, not headers. The backend therefore forwards
// signed-out browsers here, where the dashboard session cookie lives: we mint
// the authorization code through /api/admin-proxy (cookie → Bearer, injected
// server-side) and then redirect the browser back to claude.ai with ?code&state.

'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

interface Agent {
  id: string;
  label?: string | null;
  wallet_public_key?: string | null;
  enabled?: number;
}

function AuthorizeInner() {
  const params = useSearchParams();
  const router = useRouter();
  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const state = params.get('state') || '';

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin-proxy/dashboard/api-keys', { cache: 'no-store' });
        if (!res.ok) throw new Error('Could not load your agents. Sign in and try again.');
        const rows = (await res.json()) as Agent[];
        if (cancelled) return;
        const enabled = rows.filter((a) => a.enabled !== 0);
        setAgents(enabled);
        const only = enabled.length === 1 ? enabled[0] : undefined;
        if (only) setSelected(only.id);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Could not load agents.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function authorize() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin-proxy/dashboard/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
          api_key_id: selected,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirect_url?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.redirect_url) {
        throw new Error(data.message || data.error || 'Authorization failed.');
      }
      window.location.assign(data.redirect_url);
    } catch (err) {
      setError((err as Error).message || 'Authorization failed.');
      setBusy(false);
    }
  }

  function cancel() {
    try {
      const url = new URL(redirectUri);
      url.searchParams.set('error', 'access_denied');
      if (state) url.searchParams.set('state', state);
      window.location.assign(url.toString());
    } catch {
      router.push('/dashboard');
    }
  }

  const missingParams = !clientId || !redirectUri || !state;

  return (
    <main
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
          maxWidth: 440,
          background: 'var(--surface-2)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 20,
          padding: '2.25rem 2rem 2rem',
          boxShadow: 'var(--shadow-hero)',
          color: 'var(--fg)',
        }}
      >
        <div style={{ fontSize: '1.15rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
          Authorize connector
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--fg-muted)', margin: '0.5rem 0 1.5rem' }}>
          Choose which agent this MCP connector acts as.
        </div>

        {missingParams && (
          <div style={{ color: 'var(--red)', fontSize: '0.85rem' }}>
            This link is incomplete (missing client_id, redirect_uri or state). Start again from
            your connector settings.
          </div>
        )}

        {!missingParams && agents === null && !error && (
          <div style={{ color: 'var(--fg-muted)', fontSize: '0.85rem' }}>Loading agents…</div>
        )}

        {agents !== null && agents.length === 0 && (
          <div style={{ color: 'var(--fg-muted)', fontSize: '0.85rem' }}>
            No agents on this dashboard yet.{' '}
            <Link href="/dashboard/agents" style={{ color: 'var(--blue)' }}>
              Create one first
            </Link>
            .
          </div>
        )}

        {agents !== null && agents.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {agents.map((a) => (
              <label
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.7rem 0.85rem',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 12,
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                <input
                  type="radio"
                  name="agent"
                  value={a.id}
                  checked={selected === a.id}
                  onChange={() => setSelected(a.id)}
                />
                <span style={{ flex: 1 }}>{a.label || 'Unnamed agent'}</span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: a.wallet_public_key ? 'var(--green)' : 'var(--fg-dim)',
                  }}
                >
                  {a.wallet_public_key ? 'wallet ready' : 'no wallet'}
                </span>
              </label>
            ))}
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: '0.9rem',
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

        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.4rem' }}>
          <button
            type="button"
            onClick={authorize}
            disabled={busy || !selected || missingParams}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              borderRadius: 999,
              border: 'none',
              background: 'var(--fg)',
              color: 'var(--bg)',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: busy || !selected ? 'not-allowed' : 'pointer',
              opacity: busy || !selected || missingParams ? 0.5 : 1,
            }}
          >
            {busy ? 'Authorizing…' : 'Authorize'}
          </button>
          <button
            type="button"
            onClick={cancel}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 999,
              border: '1px solid var(--border-hairline)',
              background: 'transparent',
              color: 'var(--fg-muted)',
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--fg-muted)',
          }}
        >
          Loading…
        </main>
      }
    >
      <AuthorizeInner />
    </Suspense>
  );
}
