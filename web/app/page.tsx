import Link from 'next/link';

export default function HomePage() {
  return (
    <>
      {/* Hero — one composition: brand, headline, sentence, CTA */}
      <section
        style={{
          minHeight: 'min(92vh, 880px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '4rem 1.5rem 5rem',
          maxWidth: 980,
          margin: '0 auto',
          position: 'relative',
        }}
      >
        <p
          className="type-eyebrow"
          style={{ marginBottom: '1.25rem', color: 'var(--blue)' }}
        >
          Stellar testnet
        </p>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(3.25rem, 9vw, 5.5rem)',
            fontWeight: 650,
            letterSpacing: '-0.045em',
            lineHeight: 1.02,
            margin: 0,
            color: 'var(--fg)',
          }}
        >
          Cora
        </h1>
        <p
          style={{
            marginTop: '1.1rem',
            maxWidth: '34ch',
            fontSize: 'clamp(1.15rem, 2.4vw, 1.45rem)',
            lineHeight: 1.35,
            letterSpacing: '-0.02em',
            color: 'var(--fg)',
            fontWeight: 500,
          }}
        >
          Financial autonomy for AI agents — without giving up financial control.
        </p>
        <p
          style={{
            marginTop: '0.85rem',
            maxWidth: '40ch',
            fontSize: '1.05rem',
            lineHeight: 1.55,
            color: 'var(--fg-muted)',
          }}
        >
          Dedicated wallets, spend limits, and virtual Visa cards on Stellar. Pay in USDC or XLM;
          get a usable card in about a minute.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem', flexWrap: 'wrap' }}>
          <Link
            href="/dashboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.85rem 1.35rem',
              borderRadius: 980,
              background: 'var(--blue)',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 560,
              fontSize: '1rem',
              letterSpacing: '-0.01em',
              transition: 'transform 100ms ease-out, opacity 160ms ease',
            }}
          >
            Sign in
          </Link>
          <a
            href="#how"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.85rem 1.35rem',
              borderRadius: 980,
              background: 'var(--surface-3)',
              color: 'var(--fg)',
              textDecoration: 'none',
              fontWeight: 520,
              fontSize: '1rem',
              letterSpacing: '-0.01em',
            }}
          >
            How it works
          </a>
        </div>
      </section>

      <section
        id="how"
        style={{
          padding: '5rem 1.5rem',
          maxWidth: 980,
          margin: '0 auto',
          borderTop: '1px solid var(--border-hairline)',
        }}
      >
        <h2
          style={{
            fontSize: 'clamp(1.75rem, 4vw, 2.35rem)',
            letterSpacing: '-0.03em',
            fontWeight: 600,
            margin: '0 0 0.75rem',
          }}
        >
          Pay on-chain. Spend anywhere Visa works.
        </h2>
        <p style={{ color: 'var(--fg-muted)', maxWidth: '40ch', lineHeight: 1.6, margin: '0 0 2.5rem' }}>
          Agents fund a Soroban receiver contract. Cora observes the payment and delivers card
          credentials — number, CVV, expiry.
        </p>
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gap: '1.5rem',
          }}
        >
          {[
            {
              n: '01',
              t: 'Create an order',
              b: 'POST /v1/orders with a USD amount. Receive Soroban payment instructions for USDC or XLM.',
            },
            {
              n: '02',
              t: 'Sign one transaction',
              b: 'The agent pays the receiver contract from its own OWS wallet. Cora never custodies funds.',
            },
            {
              n: '03',
              t: 'Receive a Visa card',
              b: 'When fulfillment completes, the agent gets PAN, CVV, and expiry — ready for online checkout.',
            },
          ].map((step) => (
            <li key={step.n} style={{ display: 'grid', gridTemplateColumns: '3.5rem 1fr', gap: '1rem' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)', fontSize: '0.85rem' }}>
                {step.n}
              </span>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.15rem', letterSpacing: '-0.02em' }}>
                  {step.t}
                </h3>
                <p style={{ margin: 0, color: 'var(--fg-muted)', lineHeight: 1.55 }}>{step.b}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="control"
        style={{
          padding: '5rem 1.5rem',
          maxWidth: 980,
          margin: '0 auto',
          borderTop: '1px solid var(--border-hairline)',
        }}
      >
        <h2
          style={{
            fontSize: 'clamp(1.75rem, 4vw, 2.35rem)',
            letterSpacing: '-0.03em',
            fontWeight: 600,
            margin: '0 0 0.75rem',
          }}
        >
          A control plane for every agent.
        </h2>
        <p style={{ color: 'var(--fg-muted)', maxWidth: '42ch', lineHeight: 1.6, margin: 0 }}>
          Budgets, approval thresholds, suspension, audit logs, and team permissions — so agents can
          operate independently while remaining accountable to you.
        </p>
      </section>

      <section
        id="mcp"
        style={{
          padding: '5rem 1.5rem 6rem',
          maxWidth: 980,
          margin: '0 auto',
          borderTop: '1px solid var(--border-hairline)',
        }}
      >
        <h2
          style={{
            fontSize: 'clamp(1.75rem, 4vw, 2.35rem)',
            letterSpacing: '-0.03em',
            fontWeight: 600,
            margin: '0 0 0.75rem',
          }}
        >
          Built for MCP-compatible agents.
        </h2>
        <p style={{ color: 'var(--fg-muted)', maxWidth: '42ch', lineHeight: 1.6, margin: '0 0 1rem' }}>
          Cora is designed so assistants like Claude can call wallets, budgets, and card purchases
          through Model Context Protocol tools — alongside the HTTP API and CLI.
        </p>
        <p
          style={{
            color: 'var(--fg-dim)',
            fontSize: '0.95rem',
            margin: 0,
            maxWidth: '40ch',
            lineHeight: 1.5,
          }}
        >
          MCP wiring ships after the core platform is stable on testnet. Use the dashboard and{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9em' }}>npx cora</code> today.
        </p>
      </section>
    </>
  );
}
