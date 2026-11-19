// Unit tests for sdk/src/config.ts — the credential-at-rest surface
// that reads and writes ~/.cora/config.json.
//
// Locks in the 2026-04-15 audit fixes:
//   F1  load refuses symbolic links (symlink attack defence)
//   F2  save re-chmods an existing ~/.cora dir to 0700 instead
//       of leaving a pre-existing loose dir untouched
//   F3  save uses crypto.randomBytes for tmp suffix and unlinks the
//       tmp on failure (no leaked temp credential files)
//   F4  assertSafeBaseUrl rejects URLs with embedded userinfo
//       (https://host.com@evil.com/ hostname-swap attack)
//   F5  load refuses files larger than MAX_CONFIG_BYTES

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  loadCoraConfig,
  saveCoraConfig,
  assertSafeBaseUrl,
  resolveCredentials,
  type CoraConfig,
} from '../config';

// ── Test harness ─────────────────────────────────────────────────────────────
// Each test gets its own tmp dir so we can muck with file permissions,
// symlinks, and oversized files without touching the real
// ~/.cora/config.json on the host.

let tmpDir: string;
let cfgPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cora-config-test-'));
  cfgPath = path.join(tmpDir, 'config.json');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function writeCfg(body: unknown, mode = 0o600): void {
  fs.writeFileSync(cfgPath, typeof body === 'string' ? body : JSON.stringify(body, null, 2), {
    mode,
  });
}

// ── Happy path ──────────────────────────────────────────────────────────────

describe('saveCoraConfig → loadCoraConfig round trip', () => {
  it('persists and reloads a minimal config', () => {
    const cfg: CoraConfig = {
      api_key: 'cora_testkey',
      api_url: 'http://127.0.0.1:4200/v1',
      created_at: new Date().toISOString(),
    };
    saveCoraConfig(cfg, cfgPath);
    const loaded = loadCoraConfig(cfgPath);
    expect(loaded).toEqual(cfg);
  });

  it('persists extended fields (wallet_name, vault_path, passphrase_env)', () => {
    const cfg: CoraConfig = {
      api_key: 'cora_testkey',
      api_url: 'http://127.0.0.1:4200/v1',
      wallet_name: 'my-agent',
      vault_path: '/data/ows',
      passphrase_env: 'MY_PASSPHRASE_VAR',
      created_at: new Date().toISOString(),
    };
    saveCoraConfig(cfg, cfgPath);
    const loaded = loadCoraConfig(cfgPath);
    expect(loaded?.wallet_name).toBe('my-agent');
    expect(loaded?.vault_path).toBe('/data/ows');
    expect(loaded?.passphrase_env).toBe('MY_PASSPHRASE_VAR');
  });

  it('returns null when the file does not exist', () => {
    const loaded = loadCoraConfig(path.join(tmpDir, 'nope.json'));
    expect(loaded).toBeNull();
  });

  it('writes the file at chmod 0600', () => {
    if (process.platform === 'win32') return; // mode bits are simulated on windows
    saveCoraConfig(
      {
        api_key: 'k',
        api_url: 'http://127.0.0.1:4200/v1',
        created_at: new Date().toISOString(),
      },
      cfgPath,
    );
    const stat = fs.statSync(cfgPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

// ── F1: reject symlinks on load ─────────────────────────────────────────────

describe('loadCoraConfig — F1 symlink refusal', () => {
  it('throws on a symlink even if the target is a valid config', () => {
    if (process.platform === 'win32') return;
    const realPath = path.join(tmpDir, 'real.json');
    writeCfg(
      {
        api_key: 'k',
        api_url: 'http://127.0.0.1:4200/v1',
        created_at: new Date().toISOString(),
      },
      0o600,
    );
    fs.renameSync(cfgPath, realPath);
    fs.symlinkSync(realPath, cfgPath);

    expect(() => loadCoraConfig(cfgPath)).toThrow(/symbolic link/i);
  });

  it('throws on a symlink pointing at a non-config target', () => {
    if (process.platform === 'win32') return;
    // Symlink pointing at a file we definitely don't want stat'd / chmoded.
    // /etc/passwd is world-readable so lstat succeeds; the symlink check
    // runs BEFORE any stat that would follow the link.
    fs.symlinkSync('/etc/passwd', cfgPath);
    expect(() => loadCoraConfig(cfgPath)).toThrow(/symbolic link/i);
  });
});

// ── F2: save re-chmods an existing loose dir ────────────────────────────────

describe('saveCoraConfig — F2 dir mode repair', () => {
  it('tightens a pre-existing 0755 directory to 0700 on save', () => {
    if (process.platform === 'win32') return;
    // Create the config dir deliberately loose BEFORE the save call.
    // mkdirSync(recursive, mode) would no-op the mode on an existing dir,
    // so the explicit chmod in saveCoraConfig is what has to fix it.
    const dir = path.join(tmpDir, 'loose-dir');
    fs.mkdirSync(dir, { mode: 0o755 });
    const target = path.join(dir, 'config.json');

    saveCoraConfig(
      {
        api_key: 'k',
        api_url: 'http://127.0.0.1:4200/v1',
        created_at: new Date().toISOString(),
      },
      target,
    );

    const stat = fs.statSync(dir);
    expect(stat.mode & 0o777).toBe(0o700);
  });
});

// ── F3: temp file hygiene ──────────────────────────────────────────────────

describe('saveCoraConfig — F3 temp file hygiene', () => {
  it('leaves no temp files in the config directory after a successful write', () => {
    saveCoraConfig(
      {
        api_key: 'k',
        api_url: 'http://127.0.0.1:4200/v1',
        created_at: new Date().toISOString(),
      },
      cfgPath,
    );
    const files = fs.readdirSync(tmpDir);
    const tempFiles = files.filter((f) => f.includes('.tmp-'));
    expect(tempFiles).toEqual([]);
  });
});

// ── F4: assertSafeBaseUrl rejects embedded credentials ─────────────────────

describe('assertSafeBaseUrl — F4 embedded credentials', () => {
  it('accepts a bare https URL', () => {
    expect(assertSafeBaseUrl('http://127.0.0.1:4200/v1')).toMatch(
      /^https:\/\/api\.cora\.com\/v1/,
    );
  });

  it('rejects a URL with a username in the userinfo (classic hostname-swap)', () => {
    // Classic hostname-swap: the humanly-readable URL starts with
    // "api.cora.dev" but the @ separator BEFORE the first /
    // makes "evil.com" the real host. Every request would carry the
    // api_key Authorization header to evil.com.
    //
    // (Note: `http://127.0.0.1:4200/v1@evil.com/` with the @ AFTER
    // the first / is NOT an attack — Node parses `/v1@evil.com/` as
    // path because the authority section ends at the first /.)
    expect(() => assertSafeBaseUrl('http://127.0.0.1:4200@evil.com/')).toThrow(
      /embedded credentials/i,
    );
  });

  it('rejects a URL with username:password userinfo', () => {
    expect(() => assertSafeBaseUrl('https://user:pass@evil.com/')).toThrow(/embedded credentials/i);
  });

  it('rejects a URL with only a username (no password)', () => {
    expect(() => assertSafeBaseUrl('https://user@evil.com/')).toThrow(/embedded credentials/i);
  });
});

// ── existing protocol check ────────────────────────────────────────────────

describe('assertSafeBaseUrl — protocol check', () => {
  it('rejects http to a non-local host without the override env', () => {
    delete process.env.CORA_ALLOW_INSECURE_BASE_URL;
    expect(() => assertSafeBaseUrl('http://api.cora.dev/v1')).toThrow(/HTTPS/);
  });

  it('allows http://localhost without the override env', () => {
    delete process.env.CORA_ALLOW_INSECURE_BASE_URL;
    expect(assertSafeBaseUrl('http://localhost:4200/v1')).toMatch(/^http:\/\/localhost/);
  });

  it('allows http://127.0.0.1 without the override env', () => {
    delete process.env.CORA_ALLOW_INSECURE_BASE_URL;
    expect(assertSafeBaseUrl('http://127.0.0.1:4000/v1')).toMatch(/^http:\/\/127\.0\.0\.1/);
  });

  it('allows http with CORA_ALLOW_INSECURE_BASE_URL=1 (any host)', () => {
    const prev = process.env.CORA_ALLOW_INSECURE_BASE_URL;
    process.env.CORA_ALLOW_INSECURE_BASE_URL = '1';
    try {
      expect(assertSafeBaseUrl('http://dev.example:4000/v1')).toMatch(/^http:\/\/dev\.example/);
    } finally {
      if (prev === undefined) delete process.env.CORA_ALLOW_INSECURE_BASE_URL;
      else process.env.CORA_ALLOW_INSECURE_BASE_URL = prev;
    }
  });

  it('rejects completely malformed URLs', () => {
    expect(() => assertSafeBaseUrl('not-a-url')).toThrow(/Invalid base URL/);
  });
});

// ── F5: size cap ───────────────────────────────────────────────────────────

describe('loadCoraConfig — F5 size cap', () => {
  it('refuses a config file larger than 16 KB', () => {
    if (process.platform === 'win32') return;
    // 20 KB of junk that still parses as JSON ({api_key, api_url, created_at, _pad})
    const padLen = 20 * 1024;
    const body = JSON.stringify({
      api_key: 'k',
      api_url: 'http://127.0.0.1:4200/v1',
      created_at: new Date().toISOString(),
      _pad: 'x'.repeat(padLen),
    });
    writeCfg(body, 0o600);

    expect(() => loadCoraConfig(cfgPath)).toThrow(/Refusing to load/i);
  });

  it('accepts a normal-sized config', () => {
    const cfg = {
      api_key: 'cora_normal',
      api_url: 'http://127.0.0.1:4200/v1',
      created_at: new Date().toISOString(),
    };
    writeCfg(cfg, 0o600);
    const loaded = loadCoraConfig(cfgPath);
    expect(loaded?.api_key).toBe('cora_normal');
  });
});

// ── resolveCredentials integration ─────────────────────────────────────────

describe('resolveCredentials', () => {
  let prevKey: string | undefined;
  let prevUrl: string | undefined;

  beforeEach(() => {
    prevKey = process.env.CORA_API_KEY;
    prevUrl = process.env.CORA_BASE_URL;
    delete process.env.CORA_API_KEY;
    delete process.env.CORA_BASE_URL;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.CORA_API_KEY;
    else process.env.CORA_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.CORA_BASE_URL;
    else process.env.CORA_BASE_URL = prevUrl;
  });

  it('rejects a userinfo-spoofed CORA_BASE_URL at resolve time (F4)', () => {
    process.env.CORA_BASE_URL = 'http://127.0.0.1:4200@evil.com/';
    process.env.CORA_API_KEY = 'cora_whatever';
    expect(() => resolveCredentials()).toThrow(/embedded credentials/i);
  });

  it('rejects a non-HTTPS CORA_BASE_URL at resolve time', () => {
    delete process.env.CORA_ALLOW_INSECURE_BASE_URL;
    process.env.CORA_BASE_URL = 'http://evil.com/';
    process.env.CORA_API_KEY = 'cora_whatever';
    expect(() => resolveCredentials()).toThrow(/HTTPS/);
  });

  it('uses explicit opts over env over config', () => {
    process.env.CORA_API_KEY = 'from_env';
    process.env.CORA_BASE_URL = 'https://env.cora.dev/v1';
    const result = resolveCredentials({ apiKey: 'from_opts' });
    expect(result.apiKey).toBe('from_opts');
    expect(result.baseUrl).toMatch(/^https:\/\/env\.cora\.com/);
  });
});
