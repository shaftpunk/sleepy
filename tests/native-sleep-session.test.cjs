const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function load(name, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src/services', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: key => imports[key] });
  return exports;
}

test('session sync copies only access token and clears native storage before sign-out', async () => {
  const calls = [];
  let beforeSignOut;
  const service = load('nativeSleepSession', {
    './liveActivityService': { liveActivitiesSupported: () => true, liveActivityBridge: {
      addListener:async()=>({remove:async()=>{}}),
      setAuthSession: async data => calls.push({ ...data }), clearAuthSession: async () => calls.push('clear'),
    } },
    '../auth/sessionLifecycle': { registerBeforeSignOut: cb => { beforeSignOut = cb; } },
    '../lib/supabase': { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-key' },
  });
  const session = { user: { id: 'owner' }, access_token: 'access', refresh_token: 'never-copy', expires_at: Math.floor(Date.now()/1000)+3600 };
  await service.synchronizeNativeSleepSession(session);
  assert.deepEqual(calls, [{ userId: 'owner', accessToken: 'access', expiresAt: session.expires_at, url: 'https://example.supabase.co', anonKey: 'public-key' }]);
  const queuedRefresh = service.synchronizeNativeSleepSession({ ...session, access_token: 'rotated' });
  await beforeSignOut();
  await queuedRefresh;
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'clear');
});

test('React command notifies only for the exact confirmed ended sleep', async () => {
  const at = '2026-11-10T16:00:00Z';
  let result = { data: { id: 'sleep', endtime: at }, error: null }, notified = 0;
  const command = load('endSleepCommand', {
    '../lib/supabase': { supabase: { rpc: (name, args) => {
      assert.equal(name, 'end_sleep'); assert.equal(args.p_sleep_id, 'sleep'); assert.equal(args.p_ended_at, at);
      return { single: async () => result };
    } } },
    './sleepPresentationEvents': { notifySleepPresentationChanged: () => { notified++; } },
  });
  assert.equal((await command.endSleep('sleep', at)).endtime, at);
  for (const error of [Error('offline'), Error('expired auth'), Error('server error')]) {
    result = { error, data: null };
    await assert.rejects(command.endSleep('sleep', at), error);
  }
  for (const data of [{ id: 'other', endtime: at }, { id: 'sleep', endtime: null }]) {
    result = { data, error: null };
    await assert.rejects(command.endSleep('sleep', at), /not confirmed/);
  }
  assert.equal(notified, 1);
});

function refreshFixture(){
  const env={generation:0,session:{user:{id:'owner'},access_token:'fresh',refresh_token:'JS-only',expires_at:Math.floor(Date.now()/1000)+3600}},calls=[];
  let event,refreshes=0;
  const service=load('nativeSleepSession',{
    './liveActivityService':{liveActivitiesSupported:()=>true,liveActivityBridge:{addListener:async(_name,callback)=>{event=callback;return {remove:async()=>{}};},
      setAuthSession:async data=>calls.push({...data}),clearAuthSession:async()=>calls.push('clear')}},
    '../auth/sessionLifecycle':{registerBeforeSignOut:()=>{},sessionGeneration:()=>env.generation,isSessionGenerationCurrent:g=>g===env.generation},
    '../lib/supabase':{supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public',supabase:{auth:{
      getSession:async()=>{if(env.gate)await env.gate;return {data:{session:env.session},error:env.error};},
      refreshSession:async()=>{refreshes++;return {data:{session:env.session},error:env.error};}}}},
  });return {service,env,calls,event:()=>event,refreshes:()=>refreshes};
}

test('expired resume mirror is ignored, then JS-owned refresh supplies only a fresh access token',async()=>{
  const f=refreshFixture();await f.service.synchronizeNativeSleepSession(f.env.session);f.calls.length=0;
  await f.service.synchronizeNativeSleepSession({...f.env.session,access_token:'expired',expires_at:1});assert.equal(f.calls.length,0);
  f.event()({ownerId:'owner',forceRefresh:false});await f.service.refreshNativeSleepSession('owner');
  assert.equal(f.calls[0].accessToken,'fresh');assert.equal(Object.hasOwn(f.calls[0],'refresh_token'),false);assert.equal(f.refreshes(),0);
});

test('expired account-switch/unknown-user mirror clears previous native credentials',async()=>{
  const f=refreshFixture();await f.service.synchronizeNativeSleepSession(f.env.session);
  await f.service.synchronizeNativeSleepSession({...f.env.session,user:{id:'different'},expires_at:1});assert.equal(f.calls.at(-1),'clear');
  const cold=refreshFixture();await cold.service.synchronizeNativeSleepSession({...cold.env.session,expires_at:1});assert.deepEqual(cold.calls,['clear']);
});

test('401 recovery rotates through the existing auth client; missing/failed auth never fabricates a native session',async()=>{
  const f=refreshFixture();await f.service.refreshNativeSleepSession('owner',true);assert.equal(f.refreshes(),1);assert.equal(f.calls.length,1);
  for(const state of [{session:null},{error:Error('offline')},{session:{user:{id:'different'}}}]){
    const x=refreshFixture();Object.assign(x.env,state);await x.service.refreshNativeSleepSession('owner',true);assert.equal(x.calls.length,0);assert.equal(x.refreshes(),0);
  }
});

test('logout/account switch fences a pending JS token refresh',async()=>{
  const f=refreshFixture();let release;f.env.gate=new Promise(r=>{release=r;});
  const pending=f.service.refreshNativeSleepSession('owner');f.env.generation++;await f.service.synchronizeNativeSleepSession(null);release();await pending;
  assert.deepEqual(f.calls,['clear']);
});
