// `cora connector register` — one-time setup for the claude.ai MCP connector.
//
// Walks the operator interactively:
//   1. Email → POST /auth/login (backend sends OTP to inbox)
//   2. OTP   → POST /auth/verify (session token returned)
//   3. List agents → pick one
//   4. POST /dashboard/oauth/clients → register OAuth client
//   5. Print exactly what to paste into claude.ai Settings → Connectors
//
// The session token is used only during this command; it is NOT written to
// disk. Run once per deployment, not once per session.
//
// Usage:
//   cora connector           (alias for register)
//   cora connector register [--api-base <url>] [--redirect-uri <uri>] [--name <label>]

import * as readline from 'readline';
import { assertSafeBaseUrl } from '../config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConnectorArgs {
  apiBase?: string;
  redirectUri?: string;
  name?: string;
  token?: string;   // bypass login: pass a raw session token directly
  email?: string;   // used with --token to skip the email prompt
  help?: boolean;
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): ConnectorArgs {
  const out: ConnectorArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '-h' || arg === '--help') out.help = true;
    else if (arg === '--api-base') out.apiBase = argv[++i];
    else if (arg.startsWith('--api-base=')) out.apiBase = arg.slice('--api-base='.length);
    else if (arg === '--redirect-uri') out.redirectUri = argv[++i];
    else if (arg.startsWith('--redirect-uri=')) out.redirectUri = arg.slice('--redirect-uri='.length);
    else if (arg === '--name') out.name = argv[++i];
    else if (arg.startsWith('--name=')) out.name = arg.slice('--name='.length);
    else if (arg === '--token') out.token = argv[++i];
    else if (arg.startsWith('--token=')) out.token = arg.slice('--token='.length);
    else if (arg === '--email') out.email = argv[++i];
    else if (arg.startsWith('--email=')) out.email = arg.slice('--email='.length);
  }
  return out;
}

function usage(): void {
  process.stderr.write(`Usage: cora connector [register] [options]

Registers a Cora OAuth client for the claude.ai MCP connector.
Run this once per deployment — not once per session.

Options:
  --api-base <url>         Backend URL. Default: http://127.0.0.1:4200
  --redirect-uri <uri>     OAuth redirect URI sent to the client.
                           Default: https://claude.ai/api/mcp/auth_callback
  --name <label>           Label for this connector. Default: claude.ai
  -h, --help               Show this message
`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function promptRequired(rl: readline.Interface, q: string): Promise<string> {
  while (true) {
    const v = (await prompt(rl, q)).trim();
    if (v.length > 0) return v;
    process.stderr.write('  (required — please enter a value)\n');
  }
}

async function apiPost(url: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function apiGet(url: string, token: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function connectorCommand(argv: string[]): Promise<number> {
  const rest = argv[0] === 'register' ? argv.slice(1) : argv;
  const args = parseArgs(rest);
  if (args.help) { usage(); return 0; }

  let apiBase = (args.apiBase || process.env.CORA_BASE_URL || 'http://127.0.0.1:4200').replace(/\/+$/, '');
  try {
    apiBase = assertSafeBaseUrl(apiBase, { context: '--api-base / CORA_BASE_URL' });
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const redirectUri = args.redirectUri || 'https://claude.ai/api/mcp/auth_callback';
  const clientName  = args.name        || 'claude.ai';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    process.stdout.write('\n╔══════════════════════════════════════════╗\n');
    process.stdout.write('║  Cora × claude.ai connector setup         ║\n');
    process.stdout.write('╚══════════════════════════════════════════╝\n\n');
    process.stdout.write(`Backend: ${apiBase}\n\n`);

    // Step 1: sign in — three paths tried in order:
    //   a) --token flag: raw session token passed directly (fastest)
    //   b) Local dev-token: backend is on localhost, no SMTP needed
    //   c) OTP email: standard flow (requires SMTP configured)
    process.stdout.write('Step 1 of 4 — Sign in to your Cora dashboard\n');
    process.stdout.write('─────────────────────────────────────────────\n');

    let sessionToken = '';
    let email = '';

    if (args.token) {
      // Path a: token passed directly via --token flag.
      sessionToken = args.token;
      // Verify it works and get the email for display.
      const meRes = await apiGet(`${apiBase}/auth/me`, sessionToken);
      if (!meRes.ok) {
        process.stderr.write(`\nerror: --token is invalid or expired (${meRes.status})\n`);
        return 1;
      }
      const me = await meRes.json() as { user: { email: string } };
      email = me.user.email;
      process.stdout.write(`✓ Using provided token (signed in as ${email})\n\n`);
    } else {
      // Determine whether the backend is running locally so we can try
      // the dev-token shortcut before falling back to OTP email.
      email = args.email || (await promptRequired(rl, 'Email address: '));
      const isLocal = apiBase.includes('localhost') || apiBase.includes('127.0.0.1') || apiBase.includes('::1');

      let gotToken = false;

      if (isLocal) {
        // Path b: dev-token (localhost only, no SMTP).
        process.stdout.write(`\nTrying local dev-token for ${email}…\n`);
        try {
          const devRes = await apiPost(`${apiBase}/auth/dev-token`, { email });
          if (devRes.ok) {
            const body = await devRes.json() as { token: string };
            sessionToken = body.token;
            gotToken = true;
            process.stdout.write(`✓ Signed in as ${email} (dev-token, no email required)\n\n`);
          }
        } catch { /* network error — fall through to OTP */ }
      }

      if (!gotToken) {
        // Path c: standard OTP email flow.
        process.stdout.write(`\nSending login code to ${email}…\n`);
        const loginRes = await apiPost(`${apiBase}/auth/login`, { email });
        if (!loginRes.ok) {
          const b = await loginRes.json().catch(() => ({})) as Record<string, unknown>;
          if ((b.error as string) === 'email_failed') {
            process.stderr.write(
              `\nerror: The backend could not send the login email.\n` +
              `SMTP is not configured. Add these to backend/.env and restart:\n\n` +
              `  SMTP_HOST=smtp.gmail.com\n` +
              `  SMTP_PORT=587\n` +
              `  SMTP_USER=you@gmail.com\n` +
              `  SMTP_PASS=<Gmail App Password>\n` +
              `  SMTP_FROM=you@gmail.com\n\n` +
              `Or point --api-base at http://localhost:4200 to use the local dev-token shortcut.\n`,
            );
          } else {
            process.stderr.write(`\nerror: login failed (${loginRes.status}): ${b.message || b.error || 'unknown'}\n`);
          }
          return 1;
        }
        process.stdout.write('✓ Check your email for a 6-digit code.\n\n');

        const otp = await promptRequired(rl, 'Enter the 6-digit code: ');
        const verifyRes = await apiPost(`${apiBase}/auth/verify`, { email, code: otp });
        if (!verifyRes.ok) {
          const b = await verifyRes.json().catch(() => ({})) as Record<string, unknown>;
          process.stderr.write(`\nerror: verification failed (${verifyRes.status}): ${b.message || b.error || 'invalid code'}\n`);
          return 1;
        }
        const body = await verifyRes.json() as { token: string };
        sessionToken = body.token;
        process.stdout.write('\n✓ Signed in.\n\n');
      }
    }

    // Step 3: pick an agent
    process.stdout.write('Step 2 of 4 — Choose which agent the connector acts as\n');
    process.stdout.write('───────────────────────────────────────────────────────\n');
    const keysRes = await apiGet(`${apiBase}/dashboard/api-keys`, sessionToken);
    if (!keysRes.ok) {
      process.stderr.write(`\nerror: could not fetch agents (${keysRes.status}). Is the backend running?\n`);
      return 1;
    }
    type AgentRow = { id: string; label?: string|null; wallet_public_key?: string|null; agent_state?: string|null };
    const agents = await keysRes.json() as AgentRow[];
    if (agents.length === 0) {
      process.stderr.write('\nerror: No agents found. Create one in the dashboard (http://localhost:3200) first.\n');
      return 1;
    }
    process.stdout.write('\nAgents in your account:\n\n');
    agents.forEach((a, i) => {
      const wallet = a.wallet_public_key ? `  ● ${a.wallet_public_key.slice(0,8)}…` : '  ○ no wallet';
      const state  = a.agent_state ? `  [${a.agent_state}]` : '';
      process.stdout.write(`  ${i+1}. ${a.label || '(unnamed)'}${state}${wallet}\n`);
    });
    process.stdout.write('\n');

    let idx = -1;
    while (idx < 0 || idx >= agents.length) {
      const pick = (await prompt(rl, `Choose agent (1–${agents.length}): `)).trim();
      const n = parseInt(pick, 10);
      if (Number.isFinite(n) && n >= 1 && n <= agents.length) idx = n - 1;
      else process.stderr.write(`  Please enter a number between 1 and ${agents.length}.\n`);
    }
    const agent = agents[idx]!;
    process.stdout.write(`\n✓ Selected: ${agent.label || agent.id}\n\n`);

    // Step 4: register OAuth client
    process.stdout.write('Step 3 of 4 — Registering OAuth client\n');
    process.stdout.write('───────────────────────────────────────\n');
    const regRes = await apiPost(
      `${apiBase}/dashboard/oauth/clients`,
      { name: clientName, redirect_uri: redirectUri },
      sessionToken,
    );
    if (!regRes.ok) {
      const b = await regRes.json().catch(() => ({})) as Record<string, unknown>;
      if (regRes.status === 503) {
        process.stderr.write('\nerror: OAuth is not enabled.\nAdd OAUTH_ENABLED=true to backend/.env and restart.\n');
      } else {
        process.stderr.write(`\nerror: registration failed (${regRes.status}): ${b.message || b.error || 'unknown'}\n`);
      }
      return 1;
    }
    const client = await regRes.json() as { client_id: string; client_secret: string };
    process.stdout.write('✓ Client registered.\n\n');

    // Step 5: print the connector config
    process.stdout.write('Step 4 of 4 — Paste these into claude.ai\n');
    process.stdout.write('──────────────────────────────────────────\n\n');
    process.stdout.write('Settings → Connectors → Add connector:\n\n');
    process.stdout.write(`  MCP server URL:  ${apiBase}/mcp\n`);
    process.stdout.write(`  Auth URL:        ${apiBase}/oauth/authorize\n`);
    process.stdout.write(`  Token URL:       ${apiBase}/oauth/token\n`);
    process.stdout.write(`  Client ID:       ${client.client_id}\n`);
    process.stdout.write(`  Client Secret:   ${client.client_secret}\n\n`);
    process.stdout.write('  ⚠  Save the Client Secret now — it will not be shown again.\n\n');

    process.stdout.write('What happens after you click Add:\n');
    process.stdout.write(`  1. claude.ai redirects you to ${apiBase}/oauth/authorize\n`);
    process.stdout.write(`  2. Sign in with ${email} and pick "${agent.label || 'your agent'}"\n`);
    process.stdout.write(`  3. Claude gets a token scoped to that agent\n`);
    process.stdout.write(`  4. Ask Claude: "Check my Cora budget" or "Buy me a $25 Visa card"\n\n`);

    if (!agent.wallet_public_key) {
      process.stdout.write(
        `  ℹ  "${agent.label || 'Your agent'}" has no wallet yet.\n` +
        `     Dashboard → Agents → ${agent.label || agent.id} → Server wallet → Create,\n` +
        `     fund the address shown, then come back to Claude.\n\n`,
      );
    }

    return 0;
  } finally {
    rl.close();
  }
}
