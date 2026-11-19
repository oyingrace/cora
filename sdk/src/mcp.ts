// MCP server stub — Phase 10 (gated).
// Full MCP wiring is intentionally NOT enabled until the Cora clone is
// verified end-to-end and Phase 10 in plan.md is explicitly approved.

export async function startMcpServer(): Promise<void> {
  const msg =
    'Cora MCP is not enabled yet.\n' +
    'Complete the local clone (see plan.md Phases 0–9), then approve Phase 10 to wire MCP tools.\n';
  process.stderr.write(msg);
  process.exit(1);
}

// Allow `node dist/mcp.js` direct execution.
if (require.main === module) {
  startMcpServer().catch((err) => {
    process.stderr.write(
      `Cora MCP stub error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
