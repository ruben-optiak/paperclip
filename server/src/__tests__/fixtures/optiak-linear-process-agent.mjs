// Deterministic agent: exercises the real process adapter without a model,
// provider credentials, writes to Linear, or access to a live instance.
const origin = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw Error('Synthetic loopback origin required');
const bootstrap = await fetch(`${origin}/fixture/runtime`, {
  headers: { authorization: `Bearer ${process.env.PAPERCLIP_API_KEY}` },
  signal: AbortSignal.timeout(5_000),
});
if (!bootstrap.ok) throw Error('Synthetic bootstrap rejected');
const { endpoint, token, tools } = await bootstrap.json();
let sequence = 0;
async function rpc(method, params) {
  const response = await fetch(`${origin}${endpoint}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }), signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  // Deliberately log the whole received envelope: the test scans the actual
  // heartbeat excerpts, resultJson and durable log file for provider canaries.
  console.log(JSON.stringify({ status: response.status, body }));
  return body;
}
await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-process', version: '1' } });
await rpc('tools/list', {});
const calls = [
  ['get_team', { query: 'OPT' }],
  ['list_issues', { team: 'OPT', state: 'started', limit: 5, orderBy: 'updatedAt' }],
  ['list_issues', { team: 'OPT', state: 'unstarted', limit: 5, orderBy: 'updatedAt' }],
  ...['OPT-101', 'OPT-102', 'OPT-201'].map(id => ['get_issue', { id }]),
];
for (const [name, args] of calls) {
  const body = await rpc('tools/call', { name: tools[name], arguments: args });
  if (body.error || body.result?.isError) throw Error('Synthetic sample unexpectedly denied');
}
const extra = await rpc('tools/call', { name: tools.get_issue, arguments: { id: 'OPT-103' } });
if (!JSON.stringify(extra).includes('linear_privacy_denied')) throw Error('Synthetic sample limit not enforced');
console.log('SYNTHETIC_LINEAR_SAMPLE_PASSED');
