const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
function load(file, imports = {}, globals = {}) {
  const exports = {};
  new vm.Script(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
    .runInNewContext({ exports, require: key => imports[key], crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Date, btoa, atob, Response, ...globals });
  return exports;
}
const lease = load('supabase/functions/sound-monitor-status/lease.ts');
const user = '10000000-0000-4000-a000-000000000001', baby = '20000000-0000-4000-a000-000000000001', sleepId = '30000000-0000-4000-a000-000000000001';
const secret = 'server-only-test-secret';
test('read-only sound lease is scoped, signed, expires and is not an Auth JWT', async () => {
  const issued = await lease.issueLease(user, baby, sleepId, secret, 1000);
  assert.equal(issued.token.split('.').length, 2);
  const verified = await lease.verifyLease(issued.token, secret, 2000);
  assert.equal(verified.scope, 'sleepy-sound-status-v1'); assert.equal(verified.sleepId, sleepId);
  assert.equal(await lease.verifyLease(issued.token, 'wrong-secret', 2000), null);
  assert.equal(await lease.verifyLease(issued.token, secret, issued.expiresAt), null);
  assert.equal(await lease.verifyLease(issued.token + 'tampered', secret, 2000), null);
  assert.ok(!issued.token.includes(secret));
});
function server(options = {}) {
  const query = table => ({ select() { return this; }, eq() { return this; }, in() { return this; },
    single: async () => ({ data: options.noAccess ? null : { id: sleepId, baby_id: baby, endtime: options.ended ? 'ended' : null, deleted_at: null }, error: options.noAccess ? {} : null }),
    then: resolve => resolve({ data: options.dbError ? null : [{ household_id: 'household' }], error: options.dbError ? {} : null }),
    limit: async () => ({ data: options.membershipRevoked ? [] : [{ user_id: user }], error: options.dbError ? {} : null }),
  });
  const client = { auth: { getUser: async () => ({ data: { user: options.unauthorized ? null : { id: user } }, error: null }),
    admin: { getUserById: async () => ({ data: { user: options.deletedUser ? null : { id: user } }, error: null }) } }, from: query };
  return load('supabase/functions/sound-monitor-status/index.ts', {
    'npm:@supabase/supabase-js@2.57.4': { createClient: () => client }, './lease.ts': lease,
  }, { Deno: { env: { get: key => key === 'SUPABASE_SERVICE_ROLE_KEY' ? secret : 'test-config' } } }).default;
}
const request = body => new Request('https://example.supabase.co/functions/v1/sound-monitor-status', { method: 'POST', body: JSON.stringify(body) });
test('issuance requires authenticated caller and RLS-visible active sleep', async () => {
  for (const options of [{ unauthorized: true }, { noAccess: true }, { ended: true }]) {
    const response = await server(options).fetch(request({ action: 'issue', sleepId })); assert.ok(response.status === 401 || response.status === 403);
  }
  const response = await server().fetch(request({ action: 'issue', sleepId }));
  assert.equal(response.status, 200); const result = await response.json(); assert.ok(result.token); assert.ok(!JSON.stringify(result).includes(secret));
});
test('native validation stops for ended sleep, removed membership or deleted user, and fails closed on DB errors', async () => {
  const issued = await lease.issueLease(user, baby, sleepId, secret);
  const body = { action: 'validate', lease: issued.token, userId: user, babyId: baby, sleepId };
  for (const options of [{ ended: true }, { membershipRevoked: true }, { deletedUser: true }, { dbError: true }]) {
    const response = await server(options).fetch(request(body)); assert.equal((await response.json()).active, false);
  }
  assert.equal((await (await server().fetch(request(body))).json()).active, true);
  assert.equal((await server().fetch(request({ ...body, sleepId: baby }))).status, 403);
  assert.equal((await server().fetch(request({ action: 'validate', lease: 'invalid' }))).status, 401);
});
