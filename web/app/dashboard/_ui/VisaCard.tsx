// Bank-app style virtual Visa card face. Shows masked placeholders until
// `revealed` details are passed in. Click-to-copy on number / cvv / expiry.

'use client';

import { useState, type CSSProperties } from 'react';

export interface CardDetails {
  number: string;
  cvv: string;
  expiry: string;
  brand?: string | null;
}

interface Props {
  card?: CardDetails | null;
  amountLabel?: string | null;
  agentLabel?: string | null;
  loading?: boolean;
  onReveal?: () => void;
  revealDisabled?: boolean;
}

function formatPan(number: string): string {
  const digits = number.replace(/\D/g, '');
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function maskPan(): string {
  return '•••• •••• •••• ••••';
}

export function VisaCard({
  card,
  amountLabel,
  agentLabel,
  loading,
  onReveal,
  revealDisabled,
}: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const revealed = Boolean(card?.number);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      /* ignore */
    }
  }

  const face: CSSProperties = {
    position: 'relative',
    width: '100%',
    aspectRatio: '1.586 / 1',
    borderRadius: 16,
    padding: '1.15rem 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflow: 'hidden',
    color: '#f7f4ef',
    background:
      'linear-gradient(145deg, #1a2332 0%, #0d1520 42%, #162032 78%, #0a1018 100%)',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
    isolation: 'isolate',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={face}>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: '-20% -10%',
            background:
              'radial-gradient(ellipse 60% 50% at 80% 0%, rgba(124,255,178,0.18), transparent 55%),' +
              'radial-gradient(ellipse 45% 40% at 10% 90%, rgba(120,160,255,0.14), transparent 60%)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '0.62rem',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.55)',
              }}
            >
              Cora
            </div>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, marginTop: 2 }}>
              {agentLabel || 'Virtual card'}
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontStyle: 'italic',
            }}
          >
            VISA
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            width: 42,
            height: 32,
            borderRadius: 6,
            background: 'linear-gradient(135deg, #d4af37 0%, #f0e6c8 45%, #b8860b 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
          }}
          aria-hidden
        />

        <button
          type="button"
          onClick={() => revealed && card && copy('number', card.number.replace(/\s/g, ''))}
          disabled={!revealed}
          title={revealed ? 'Copy card number' : undefined}
          style={{
            position: 'relative',
            zIndex: 1,
            background: 'transparent',
            border: 'none',
            padding: 0,
            textAlign: 'left',
            cursor: revealed ? 'pointer' : 'default',
            color: '#f7f4ef',
            fontFamily: 'var(--font-mono)',
            fontSize: '1.15rem',
            letterSpacing: '0.12em',
            fontWeight: 500,
          }}
        >
          {revealed && card ? formatPan(card.number) : maskPan()}
        </button>

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: '1rem',
          }}
        >
          <button
            type="button"
            onClick={() => revealed && card && copy('expiry', card.expiry)}
            disabled={!revealed}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              textAlign: 'left',
              cursor: revealed ? 'pointer' : 'default',
              color: '#f7f4ef',
            }}
          >
            <div
              style={{
                fontSize: '0.55rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
              }}
            >
              Expires
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', marginTop: 2 }}>
              {revealed && card ? card.expiry : '••/••'}
            </div>
          </button>
          <button
            type="button"
            onClick={() => revealed && card && copy('cvv', card.cvv)}
            disabled={!revealed}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              textAlign: 'left',
              cursor: revealed ? 'pointer' : 'default',
              color: '#f7f4ef',
            }}
          >
            <div
              style={{
                fontSize: '0.55rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
              }}
            >
              CVV
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', marginTop: 2 }}>
              {revealed && card ? card.cvv : '•••'}
            </div>
          </button>
          {amountLabel ? (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div
                style={{
                  fontSize: '0.55rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.45)',
                }}
              >
                Value
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', marginTop: 2 }}>
                {amountLabel}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {!revealed && onReveal ? (
        <button
          type="button"
          onClick={onReveal}
          disabled={revealDisabled || loading}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '0.55rem 0.85rem',
            borderRadius: 6,
            cursor: revealDisabled || loading ? 'not-allowed' : 'pointer',
            background: 'var(--green-muted)',
            color: 'var(--green)',
            border: '1px solid var(--green-border)',
            opacity: revealDisabled || loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Revealing…' : 'Reveal card details'}
        </button>
      ) : null}

      {copied ? (
        <div style={{ fontSize: '0.7rem', color: 'var(--green)' }}>Copied {copied}</div>
      ) : revealed ? (
        <div style={{ fontSize: '0.7rem', color: 'var(--fg-dim)' }}>
          Tap number, expiry, or CVV to copy
        </div>
      ) : null}
    </div>
  );
}
