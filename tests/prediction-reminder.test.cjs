const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');

test('one local request per wake interval, cancellation, drift, permission and relaunch', async () => {
  let now = 1800000000000, allowed = true, pending = null, writes = 0;
  const store = new Map();
  const native = {
    schedule: async request => { pending = request; writes++; },
    cancel: async () => { pending = null; },
  };
  function launch() {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/predictionReminder.ts','utf8'), {
      compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 },
    }).outputText, { exports, console, Date:{now:()=>now}, localStorage:{
      getItem:key=>store.get(key)??null, setItem:(k,v)=>store.set(k,v), removeItem:k=>store.delete(k),
    }, require:name=>name.endsWith('/core') ? {
      Capacitor:{getPlatform:()=>'ios',isPluginAvailable:()=>true},registerPlugin:()=>native,
    } : {PushNotifications:{checkPermissions:async()=>({receive:allowed?'granted':'denied'})}} });
    return exports.reconcileReminder;
  }
  let reconcile = launch();
  const event = {event:'user.baby.sleep',peak:now+3600000,title:'test',body:'test'};
  await reconcile(null); assert.equal(pending,null);
  allowed=false; await reconcile(event); assert.equal(pending,null);
  allowed=true; await reconcile(event); assert.equal(pending.at,event.peak-600000);
  reconcile=launch(); await reconcile({...event,peak:event.peak+300000}); assert.equal(writes,1);
  await reconcile({...event,peak:event.peak+600000}); assert.equal(writes,2);
  await reconcile(null); assert.equal(pending,null);
  await reconcile(event); now=pending.at+1;
  await reconcile({...event,peak:event.peak+3600000}); assert.equal(pending,null);
  await reconcile({...event,event:'new cycle',peak:now+3600000}); assert.ok(pending);
});
