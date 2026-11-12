/* Real React screens, synthetic data and blocked external requests. No app/API
   writes. Pass an existing Playwright module; no production dependency needed:
   node tests/mobile-layout.cjs <playwright module path> [--quick]
   SLEEPY_CHROMIUM_PATH can select an already installed Chromium executable. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.argv[2] || 'playwright');
const port = process.env.SLEEPY_LAYOUT_PORT || '5180';
const root = path.resolve(__dirname, '..'), base = `http://127.0.0.1:${port}`;
const output = path.join(os.tmpdir(), 'sleepy-mobile-layout');
fs.mkdirSync(output, { recursive: true });
const fixture = `import React from '/node_modules/.vite/deps/react.js';import DOM from '/node_modules/.vite/deps/react-dom_client.js';
import App from '/src/App.tsx';import Auth from '/src/pages/Auth.tsx';import Onboarding from '/src/pages/Onboarding.tsx';
import AuthGate from '/src/components/AuthGate.tsx';import Splash from '/src/components/SplashScreen.tsx';
import FeedModal from '/src/components/FeedModal.tsx';import SleepModal from '/src/components/SleepModal.tsx';
import Split from '/src/components/SleepSplitModal.tsx';import Message from '/src/components/FamilyMessageModal.tsx';
import {useAppStore} from '/src/stores/appStore.ts';import {useSoundStore} from '/src/stores/soundStore.ts';
import {HouseholdContextProvider,useHouseholdContext} from '/src/households/HouseholdContextProvider.tsx';
import {EntitlementProvider,useEntitlements} from '/src/entitlements/EntitlementProvider.tsx';
import HouseholdContextSelector from '/src/households/HouseholdContextSelector.tsx';
import '/src/index.css';import '/src/themes/alive/alive.css';import '/src/themes/retro/retro.css';
const p=new URLSearchParams(location.search),view=p.get('view'),theme=p.get('theme')||'dark';
document.documentElement.dataset.visualTheme=p.get('skin')||'default';
const baby={id:'baby',name:p.has('long')?'Amalie Alexandra Strande Engevik':'Amalie',birth_date:'2026-08-03'};
useAppStore.setState({language:p.get('lang')||'no',theme,visualTheme:p.get('skin')||'default',currentBabyId:'baby',currentBbyId:'fixture-baby',babies:[baby,{...baby,id:'baby-2',name:'Alexander'}]});
useSoundStore.setState({enabled:!!p.get('sound'),sensitivity:'medium'});
const sleep={id:'sleep',baby_id:'baby',starttime:new Date(Date.now()-12*3600000).toISOString(),endtime:new Date(Date.now()-2*3600000).toISOString(),durationminutes:600,rate:'5',deleted_at:null,note:'Testnotat / a synthetic note'};
const done=()=>{};const views={auth:React.createElement(Auth),onboarding:React.createElement(Onboarding,{onComplete:async()=>{}}),
gate:React.createElement(AuthGate,null,'Ready'),splash:React.createElement(Splash),
feed:React.createElement(FeedModal,{onClose:done,onSaved:done}),sleep:React.createElement(SleepModal,{sleep,onClose:done,onSaved:done}),
newSleep:React.createElement(SleepModal,{onClose:done,onSaved:done}),split:React.createElement(Split,{sleep,onClose:done,onSaved:done}),
message:React.createElement(Message,{babyId:'baby',babyName:baby.name,onClose:done})};
function Probe(){const h=useHouseholdContext(),e=useEntitlements();window.__probe={h,e};window.__setBaby=id=>useAppStore.setState({currentBabyId:id});return React.createElement('main',null,React.createElement(HouseholdContextSelector),React.createElement('output',{id:'probe'},JSON.stringify({user:h.userId,baby:h.babyId,household:h.householdId,loading:e.loading,tier:e.tier,isPlus:e.isPlus,verification:e.verificationState,canUse:e.canUse('family'),wouldAllow:e.wouldAllow('family')})));}
const wrapped=child=>React.createElement(HouseholdContextProvider,null,React.createElement(EntitlementProvider,null,child));
DOM.createRoot(document.getElementById('root')).render(view==='entitlements'?wrapped(React.createElement(Probe)):view?React.createElement('div',{'data-theme':theme},views[view]):wrapped(React.createElement(App)));`;
const params = `const p=new URLSearchParams(location.search);`;
const records = `${params}const now=Date.now(),iso=n=>new Date(n).toISOString();const sleeps=p.has('empty')?[]:Array.from({length:35},(_,i)=>({id:i?'sleep-'+i:'sleep',baby_id:'baby',starttime:iso(now-(i*24+12)*3600000),endtime:iso(now-(i*24+2)*3600000),durationminutes:600,sleep_type:'sleep',rate:'5',deleted_at:null,note:p.has('long')?'Et langt notat som skal være lesbart på små skjermer. '+ 'x'.repeat(65):'A short note'}));const feeds=p.has('empty')?[]:Array.from({length:5},(_,i)=>({id:'feed-'+i,baby_id:'baby',feedtype:['bottle','breast','food'][i%3],amountml:120,side:'left',starttime:iso(now-i*7200000),note:'A synthetic feeding note'}));`;
const failure = `const blocked=async()=>{throw Error('duplicate key value violates unique constraint synthetic_settings_test')};`;
function mock(url) {
  if(process.argv.includes('--entitlements-only')&&url==='/src/auth/AuthProvider.tsx')return `import React from '/node_modules/.vite/deps/react.js';const {useSyncExternalStore}=React;let user='user';const listeners=new Set();window.__setUser=id=>{user=id;for(const f of listeners)f()};export const useAuth=()=>{const id=useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>user);return {user:id?{id}:null,loading:false}};`;
  if(url.endsWith('/householdContextService.ts'))return `${params}export async function getHouseholdCandidates(user,baby){await new Promise(r=>setTimeout(r,window.__contextDelay||0));if(window.__contextFailure)throw Error('Synthetic offline');return window.__candidates||(p.has('multiple')?[{id:'A',name:'Household A',role:'viewer'},{id:'B',name:'Household B',role:'parent'}]:[{id:'household',name:'Synthetic household',role:'owner'}])};export const subscribeHouseholdContext=()=>()=>{};`;
  if(url.endsWith('/entitlementService.ts'))return `import features from '/src/entitlements/features.json';export async function resolveHouseholdEntitlements(householdId){const tier=window.__tier||'free',delay=window.__resolutionDelay||0;await new Promise(r=>setTimeout(r,delay));if(window.__resolutionFailure)throw Error('Synthetic unavailable RPC');return {householdId,tier,isPlus:tier==='plus',features:Object.keys(features).filter(f=>tier==='plus'||features[f].requiredTier==='free'),verificationState:'verified',verifiedAt:new Date().toISOString(),validUntil:null,recheckAt:new Date(Date.now()+300000).toISOString(),policyVersion:1}};`;
  if (url === '/src/auth/AuthProvider.tsx') return `${params}export const useAuth=()=>({user:{id:'user',email:'parent.with.a.long.synthetic.email@example.invalid',user_metadata:{full_name:'Alexandra Strande Engevik'}},session:{user:{id:'user'}},loading:p.has('loading'),signOut:async()=>{}});`;
  if (url === '/src/lib/supabase.ts') return `export const supabase={auth:{onAuthStateChange:f=>{window.recovery=()=>f('PASSWORD_RECOVERY');return {data:{subscription:{unsubscribe(){}}}}},getUser:async()=>({data:{user:{id:'user'}}})}};`;
  if (url === '/src/services/sleepService.ts') return records + failure + `
    if(p.has('probability-fixture')){const at=(days,h,m=0)=>{const d=new Date();d.setDate(d.getDate()-days);d.setHours(h,m,0,0);return d.getTime()};const row=(start,end)=>({id:String(start),baby_id:'baby',starttime:iso(start),endtime:iso(end),durationminutes:(end-start)/60000,sleep_type:'sleep',rate:'4',deleted_at:null});sleeps.splice(0,sleeps.length,...Array.from({length:12},(_,i)=>{const d=i+1;return [row(at(d+1,23,30),at(d,7)),row(at(d,d<=9?9:11,30),at(d,d<=9?10:12,30)),row(at(d,20),at(d,21))]}).flat());}
    if(p.has('home-fixture')&&!p.has('empty')){sleeps.splice(0,sleeps.length,...Array.from({length:24},(_,i)=>({...sleeps[0],id:'history-'+i,baby_id:'baby',starttime:iso(now-(63+i*120)*60000),endtime:iso(now-(18+i*120)*60000),durationminutes:45,sleep_type:'sleep',rate:'4.8',deleted_at:null})));}
    export const getActiveSleep=async()=>window.__homeActive!==undefined?window.__homeActive:p.has('active')?{...sleeps[0],id:'active',starttime:p.has('home-fixture')?iso(now-42*60000):sleeps[0].starttime,endtime:null}:null,
    getLastCompletedSleep=async()=>window.__homeLast||(p.has('hold-room')?{...sleeps[0],endtime:iso(now-2*3600000)}:sleeps[0])||null,getRecentSleeps=async()=>sleeps.slice(0,8),getAllSleeps=async()=>sleeps,getSleepsFromDate=async()=>sleeps,getSleepsOverlappingPeriod=async()=>sleeps;
    export async function startSleep(babyId,minutes=0){if(!p.has('home-actions'))return blocked();(window.__sleepActions??=[]).push({kind:'start',minutes});if(p.has('action-error'))return blocked();await new Promise(r=>setTimeout(r,100));return window.__homeActive={...sleeps[0],id:'started',baby_id:babyId,starttime:iso(Date.now()-minutes*60000),endtime:null};}
    export async function stopSleep(id,start,minutes=0){if(!p.has('home-actions'))return blocked();(window.__sleepActions??=[]).push({kind:'stop',minutes});if(p.has('action-error'))return blocked();await new Promise(r=>setTimeout(r,100));window.__homeActive=null;return window.__homeLast={...sleeps[0],id,starttime:start,endtime:iso(Date.now()-minutes*60000)};}
    export {blocked as resumeSleep,blocked as updateSleep,blocked as deleteSleep,blocked as splitSleep,blocked as createManualSleep};`;
  if(url.endsWith('/sleepEstimateService.ts')&&process.argv.includes('--home-only'))return params+`export const getActiveSleepEstimate=async sleep=>({classification:p.get('classification')||'SHORT_SLEEP_LIKE',estimatedWakeTime:!p.has('classification')||p.get('classification')==='SHORT_SLEEP_LIKE'?new Date(Date.parse(sleep.starttime)+57*60000).toISOString():null}),sleepEstimateHistoryRevision=()=>0,subscribeSleepEstimateHistory=()=>()=>{},publishSleepEstimateHistory=()=>{};`;
  if (url === '/src/services/feedService.ts') return records + failure + `export const getLastFeed=async()=>feeds[0]||null,getRecentFeeds=async()=>feeds,getFeedsFromDate=async()=>feeds;export {blocked as createFeed,blocked as updateFeed,blocked as deleteFeed};`;
  if (url.endsWith('/sleepRealtime.ts')) return `export const subscribeToSleepChanges=()=>()=>{};`;
  if (url.endsWith('/feedRealtime.ts')) return `export const subscribeToFeedChanges=()=>()=>{};`;
  if (url.endsWith('/householdService.ts')) return params + failure + `export async function getMyHouseholds(){if(p.has('error'))throw Error('Synthetic long failure message. '+ 'x'.repeat(70));return [{id:'household',name:'Strande Engevik – familie med et langt navn',role:'owner'}]};export const getMyBabies=async()=>[];export {blocked as updateBabyBirthDate,blocked as createBabyForHousehold,blocked as createHouseholdWithBaby};`;
  if (url.endsWith('/invitationService.ts')) return `export const createHouseholdInvitation=async()=>({token:'synthetic-layout-only-'+ 'A'.repeat(65),expires_at:new Date().toISOString()}),acceptHouseholdInvitation=async()=>({household_name:'Synthetic family'});`;
  if (url.endsWith('/pushService.ts')) return `export const hasPushSubscription=async()=>true,attributePushSubscription=async()=>{},enablePushNotifications=async()=>{},disablePushNotifications=async()=>{},sendTestNotification=async()=>{};`;
  if (url.endsWith('/nativePushService.ts')) return `export const isNativeIOS=()=>true,nativePushState=()=> 'enabled',subscribeNativePush=()=>()=>{};`;
  if (url.endsWith('/notificationSettingsService.ts')) return params + failure + `export const getNotificationSettings=async()=>{if(p.has('error'))throw Error('duplicate key value violates unique constraint synthetic_settings_test');return {feeding_reminder_enabled:true,feeding_reminder_minutes:180}},getSleepEventNotificationSettings=async()=>({notify_sleep_started:true,notify_sleep_ended:true});export {blocked as updateFeedingReminder,blocked as updateFeedingReminderMinutes,blocked as updateSleepEventNotificationSettings};`;
  if (url.endsWith('/appleAuthService.ts')) return params + failure + `export const appleSignInSupported=()=>!p.has('web');export {blocked as signInWithApple};`;
  if (url.endsWith('/nativeSoundMonitoring.ts')) return `${params}const state={active:p.get('sound')==='listening',running:p.get('sound')==='listening',status:p.get('sound')||'off',queueCount:0,level:.6,rms:.1,syncFailed:false};export const nativeSoundSupported=()=>true,nativeSoundSnapshot=()=>state,subscribeNativeSound=()=>()=>{},startNativeSound=async()=>{},stopNativeSound=async()=>{},synchronizeNativeSoundEvents=async()=>{},validateNativeSoundSleep=async()=>{};`;
  if (url.endsWith('/soundEventService.ts')) return params + `export async function getSoundEventsForSleep(id){await new Promise(r=>setTimeout(r,80));if(p.has('error'))throw Error('Synthetic read error');if(p.has('empty'))return [];const end=Date.now()-2*3600000;return Array.from({length:6},(_,i)=>({id:'event-'+i,sleep_id:id,baby_id:'baby',started_at:new Date(end-(i+1)*3600000).toISOString(),ended_at:new Date(end-(i+1)*3600000+64000).toISOString(),avg_level:.04,max_level:i%2?.3:.06}));};export const createSoundEvent=async()=>{};`;
  if (url.endsWith('/familyMessageService.ts')) return failure + `export {blocked as sendFamilyMessage};`;
  if (url.endsWith('/NativeSoundLifecycle.tsx') || url.endsWith('/NativePushNavigation.tsx')) return `export default function(){return null}`;
  if (url.includes('@capacitor_core')) return `export const Capacitor={isNativePlatform:()=>true,getPlatform:()=>'ios',isPluginAvailable:()=>true};export const registerPlugin=()=>({selection:async()=>{window.__haptics=(window.__haptics||0)+1},addListener:async()=>({remove:async()=>{}}),setContext:async()=>{},reconcileBaby:async()=>{},setEnabled:async()=>{if(window.__sleepyBridgeFailure)throw Error('Synthetic native bridge failure')},reconcile:async()=>{},endAll:async()=>{},getAppInfo:async()=>({version:'1.0',build:'14'})});`;
}

async function main() {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], { cwd: root, stdio: 'ignore' });
  let browser;
  try {
    for (let n = 0; n < 100; n++) { try { if ((await fetch(base)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch({ headless: true, ...(process.env.SLEEPY_CHROMIUM_PATH ? { executablePath: process.env.SLEEPY_CHROMIUM_PATH } : {}) });
    const page = await browser.newPage();
    if(process.argv.includes('--home-only')&&process.argv.includes('--quick'))await page.clock.install();
    const errors = [], failures = [], screens = [];
    page.on('pageerror', e => { errors.push(e.message); if(process.argv.includes('--entitlements-only')||process.argv.includes('--home-only'))console.error(e.message); });
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== base) return route.abort();
      const body = u.pathname === '/src/main.tsx' ? fixture : mock(u.pathname);
      if (body) {
        const hash = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/.vite/deps/_metadata.json'), 'utf8')).browserHash;
        return route.fulfill({ contentType: 'application/javascript', body: body.replace(/(\/node_modules\/\.vite\/deps\/[^'"?]+\.js)(['"])/g, `$1?v=${hash}$2`) });
      }
      return route.continue();
    });
    const requestedWidth=process.argv.find(value=>value.startsWith('--width='))?.split('=')[1];
    const sizes = (process.argv.includes('--quick') ? [[320,568]] : [[320,568],[375,667],[390,844],[430,932]])
      .filter(([width])=>!requestedWidth||width===Number(requestedWidth));
    const themes = process.argv.includes('--quick') ? ['dark'] : ['dark','light'];
    let context = '', query = '';
    async function visit(route = '/', extra = '') {
      await page.goto(`${base}${route}?${query}&${extra}`);
      await page.waitForSelector('main, [role="dialog"], .feed-modal, .splash-screen');
      await page.waitForTimeout(100);
    }
    async function check(name, screenshot = false) {
      const findings = await page.evaluate(() => {
        const bad = [], vw = innerWidth;
        const luminance = rgb => {
          const c=rgb.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
          return c[0]*.2126+c[1]*.7152+c[2]*.0722;
        };
        if (document.documentElement.scrollWidth > vw + 1) bad.push('horizontal page overflow');
        for (const e of document.querySelectorAll('button, input:not([type="checkbox"]):not([type="radio"]), select, textarea, .feed-modal')) {
          const r=e.getBoundingClientRect(); if (!r.width || !r.height || e.closest('details:not([open])')) continue;
          if (r.left < -1 || r.right > vw + 1) bad.push('outside viewport: '+e.tagName+'.'+e.className);
          if (e.tagName === 'BUTTON' && r.height < 43.9) bad.push('short target: '+e.className+' '+r.height);
          if (e.tagName === 'BUTTON' && e.scrollWidth > e.clientWidth + 2) bad.push('clipped button: '+e.className);
          if (e.matches('input,select,textarea') && r.height < 45.9) bad.push('short control: '+e.className+' '+r.height);
          if (e.matches('.feed-modal') && (r.top < -1 || r.bottom > innerHeight + 1 || e.scrollWidth > e.clientWidth + 1)) bad.push('modal overflow');
          if(e.matches('.primary-button:not(:disabled),.analysis-tab.active')){
            const s=getComputedStyle(e),bg=s.backgroundColor.match(/[\d.]+/g)?.map(Number),fg=s.color.match(/[\d.]+/g)?.map(Number);
            if(bg&&fg&&(bg[3]??1)===1){const a=luminance(bg),b=luminance(fg);if((Math.max(a,b)+.05)/(Math.min(a,b)+.05)<4.5)bad.push('low-contrast action: '+e.className);}
          }
        }
        const nav=document.querySelector('.bottom-nav'), main=document.querySelector('.app-shell > main');
        for(const card of document.querySelectorAll('.stat-card')){
          const a=card.querySelector('span')?.getBoundingClientRect(),b=card.querySelector('strong')?.getBoundingClientRect();
          if(a&&b&&a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1)bad.push('metric label/value overlap');
        }
        if(nav&&main){window.scrollTo(0,document.documentElement.scrollHeight);if(main.getBoundingClientRect().bottom>nav.getBoundingClientRect().top+1)bad.push('content under bottom nav');}
        return [...new Set(bad)];
      });
      screens.push(context+'/'+name);
      if (findings.length) failures.push({ screen: context+'/'+name, findings });
      if (screenshot || findings.length) await page.screenshot({ path: path.join(output, `${context}-${name}.png`.replace(/[^\w.-]/g,'_')), fullPage: true });
      // A full-page capture relocates Alive's fixed landscape to the current
      // viewport. Also capture the real initial viewport for Home visual review.
      if(process.argv.includes('--home-only')&&['home-awake','home-sleeping-short'].includes(name)){
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:path.join(output,`${context}-${name}-viewport.png`)});
      }
    }
    if(process.argv.includes('--entitlements-only')){
      const state=()=>page.locator('#probe').textContent().then(JSON.parse);
      const wait=async predicate=>page.waitForFunction(predicate);
      await page.goto(base+'/?view=entitlements');
      await wait(()=>window.__probe?.e.verificationState==='verified');
      assert.deepEqual(await state(),{user:'user',baby:'baby',household:'household',loading:false,tier:'free',isPlus:false,verification:'verified',canUse:true,wouldAllow:false});
      await page.evaluate(()=>{window.__tier='plus';document.dispatchEvent(new Event('resume'))});
      await wait(()=>window.__probe.e.isPlus);assert.equal((await state()).wouldAllow,true);
      await page.evaluate(()=>{window.__resolutionFailure=true;document.dispatchEvent(new Event('resume'))});
      await wait(()=>window.__probe.e.verificationState==='unknown');assert.equal((await state()).tier,null);assert.equal((await state()).canUse,true);
      await page.evaluate(()=>{window.__resolutionFailure=false;window.__candidates=[{id:'A',name:'Household A',role:'viewer'},{id:'B',name:'Household B',role:'parent'}];window.__probe.h.refresh()});
      await wait(()=>window.__probe.h.candidates.length===2);assert.equal((await state()).household,null,'multiple households require choice');
      await page.locator('.household-context-notice select').selectOption('B');await wait(()=>window.__probe.e.isPlus&&window.__probe.h.householdId==='B');
      await page.evaluate(()=>window.__setBaby('baby-2'));await wait(()=>window.__probe.h.babyId==='baby-2'&&!window.__probe.h.loading);
      assert.equal((await state()).household,null,'another baby must not inherit the choice');
      await page.evaluate(()=>window.__setBaby('baby'));await wait(()=>window.__probe.h.householdId==='B');
      await page.evaluate(()=>history.replaceState(null,'','/?view=entitlements&multiple'));await page.reload();
      await wait(()=>window.__probe?.h.householdId==='B'&&window.__probe.e.verificationState==='verified');
      assert.equal((await state()).household,'B','selection survives browser restart with fresh membership validation');
      // Stored selection remains user/baby scoped and is validated against fresh candidates.
      await page.evaluate(()=>{window.__probe.h.refresh()});await page.waitForTimeout(100);assert.equal((await state()).household,'B');
      await page.evaluate(()=>{window.__candidates=[{id:'A',name:'Household A',role:'viewer'}];window.__probe.h.refresh()});
      await wait(()=>window.__probe.h.householdId==='A');
      await page.evaluate(()=>{window.__candidates=[];window.__probe.h.refresh()});
      await wait(()=>window.__probe.h.candidates.length===0);assert.equal((await state()).household,null);assert.equal((await state()).tier,null);
      await page.evaluate(()=>{window.__candidates=[{id:'A',name:'Household A',role:'viewer'},{id:'B',name:'Household B',role:'parent'}];window.__probe.h.refresh()});
      await wait(()=>window.__probe.h.candidates.length===2);
      await page.evaluate(()=>{window.__resolutionDelay=250;window.__tier='plus';window.__probe.h.choose('A')});
      await wait(()=>window.__probe.h.householdId==='A');
      await page.evaluate(()=>{window.__resolutionDelay=0;window.__tier='free';window.__probe.h.choose('B')});
      await wait(()=>window.__probe.e.tier==='free'&&window.__probe.h.householdId==='B');
      await page.waitForTimeout(350);assert.equal((await state()).tier,'free','old Plus response must not leak into new household');
      await page.evaluate(()=>{window.__contextDelay=150;window.__setUser('other')});
      await wait(()=>window.__probe.h.userId==='other');assert.equal((await state()).household,null,'account switch fences previous context immediately');
      await wait(()=>window.__probe.h.candidates.length===2);assert.equal((await state()).household,null,'another user cannot inherit stored household');
      await page.evaluate(()=>window.__setUser(null));await wait(()=>window.__probe.h.userId===null);
      assert.equal((await state()).tier,null);assert.equal((await state()).canUse,true);
      assert.deepEqual(errors,[]);console.log('Entitlement/provider browser lifecycle checks passed');return;
    }
    for (const [width,height] of sizes) for (const theme of themes) for (const lang of ['no','en']) {
      const skin=(process.argv.find(value=>value.startsWith('--skin='))||'--skin=default').split('=')[1];
      context=`${width}x${height}-${theme}-${lang}-${skin}`;query=`theme=${theme}&lang=${lang}&skin=${skin}&long`;
      await page.setViewportSize({width,height});
      if(process.argv.includes('--home-only')){
        const action=page.locator('.home-sleep-actions > .sleep-action'),change=page.locator('.home-change-time');
        const ready=async(extra='')=>{await visit('/','home-fixture&home-actions&'+extra);await page.waitForFunction(()=>{const e=document.querySelector('.home-sleep-actions > .sleep-action');return e&&!e.disabled;});};
        await ready();assert.ok((await page.locator('.sleep-timer').textContent()).includes('18'));
        assert.equal(await page.locator('.home-next-sleep').count(),1);
        assert.match(await page.locator('.today-stats > div').last().textContent(),lang==='en'?/4\.8/:/4,8/);
        await check('home-awake',true);
        await change.click();await page.waitForSelector('[role="dialog"]');await check('home-start-sheet',true);
        await page.getByRole('button',{name:lang==='en'?'Choose time':'Velg tidspunkt',exact:true}).click();await check('home-start-explicit-time',true);
        await page.keyboard.press('Escape');assert.equal(await page.locator('[role="dialog"]').count(),0);
        assert.equal(await change.evaluate(e=>e===document.activeElement),true);
        await action.focus();await page.keyboard.down('Enter');await page.waitForTimeout(180);
        await page.keyboard.down('Enter');await page.keyboard.up('Enter');
        assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:'start',minutes:0}]);
        assert.equal(await action.evaluate(e=>e===document.activeElement),true,'state transition should preserve keyboard action focus');
        await ready('active&sound=listening');await page.waitForSelector('progress');
        assert.equal(await page.locator('.home-wake-time').count(),1);await check('home-sleeping-short',true);
        assert.ok((await page.locator('.home-sound-controls > summary').textContent()).includes(lang==='en'?'Sound monitoring active':'Lydm\u00e5ling aktiv'));
        await page.locator('.home-sound-controls > summary').click();await check('home-sound-expanded');
        await action.click();await page.waitForTimeout(180);assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:'stop',minutes:0}]);
        for(const ending of [false,true]){
          await ready(ending?'active':'');await action.evaluate(e=>e.scrollIntoView({block:'center'}));let r=await action.boundingBox();
          await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.waitForTimeout(1300);
          assert.ok((await action.textContent()).includes('10'),JSON.stringify({context,ending,text:await action.textContent(),bounds:await action.boundingBox(),point:r}));await page.mouse.up();await page.waitForTimeout(180);
          assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:ending?'stop':'start',minutes:10}]);
          assert.equal(await page.evaluate(()=>window.__haptics),2,'activation and first increment each produce one haptic');
          assert.equal(await action.evaluate(e=>e.classList.contains('is-pressed')),false,'release clears pressed feedback');
          await ready(ending?'active':'');await action.evaluate(e=>e.scrollIntoView({block:'center'}));r=await action.boundingBox();
          await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
          assert.equal(await action.evaluate(e=>e.classList.contains('is-pressed')),true,'pointer-down gives immediate feedback');
          assert.notEqual(await action.evaluate(e=>getComputedStyle(e).filter),'none','pressed styling is visible without a layout change');
          assert.equal(await page.evaluate(()=>window.__haptics||0),0,'no press-down haptic');
          await page.mouse.move(r.x+r.width/2+14,r.y+r.height/2);await page.waitForTimeout(500);
          assert.ok((await action.textContent()).includes('5'));await page.mouse.up();await page.waitForTimeout(180);
          assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:ending?'stop':'start',minutes:5}],'ordinary drift should still commit once');
          await ready(ending?'active':'');await action.evaluate(e=>e.scrollIntoView({block:'center'}));r=await action.boundingBox();
          await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.move(r.x+r.width/2+32,r.y+r.height/2);await page.mouse.up();
          assert.equal(await page.evaluate(()=>(window.__sleepActions||[]).length),0);
          assert.equal(await action.evaluate(e=>e.classList.contains('is-pressed')),false);
          if(process.argv.includes('--quick')){
            for(const reason of ['capture-failure','outside-release','lost-capture','pointercancel','scroll','pause','hidden','blur','unmount']){
              await ready(ending?'active':'');await action.evaluate(e=>e.scrollIntoView({block:'center'}));
              if(reason==='capture-failure'){
                await action.evaluate(e=>{e.setPointerCapture=()=>{throw Error('Synthetic capture failure')};});await action.click();
              }else{
                await action.evaluate(e=>e.addEventListener('pointerdown',ev=>{window.__heldPointer=ev.pointerId;},{once:true}));
                const box=await action.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(700);
                if(reason==='outside-release')await action.dispatchEvent('pointerup',{pointerId:await page.evaluate(()=>window.__heldPointer),clientX:box.x-20,clientY:box.y});
                if(reason==='lost-capture'){
                  await action.evaluate(e=>e.releasePointerCapture(window.__heldPointer));
                  // Capture release is pending until the next pointer event.
                  await page.mouse.move(box.x+box.width/2+1,box.y+box.height/2);
                }
                if(reason==='pointercancel')await action.dispatchEvent('pointercancel',{pointerId:await page.evaluate(()=>window.__heldPointer)});
                if(reason==='scroll')await page.evaluate(()=>window.scrollBy(0,window.scrollY>0?-20:20));
                if(reason==='pause')await page.evaluate(()=>document.dispatchEvent(new Event('pause')));
                if(reason==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
                if(reason==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
                if(reason==='unmount'){
                  await page.locator('.bottom-nav a[href="/history"]').evaluate(e=>e.click());
                  // A lazy route can retain Home while its chunk loads. Test
                  // actual unmount rather than assuming it occurs within 30ms.
                  await action.waitFor({state:'detached'});
                }
                await page.waitForTimeout(30);await page.mouse.up();
              }
              assert.equal(await page.evaluate(()=>(window.__sleepActions||[]).length),0,reason+' must not write sleep');
              if(reason!=='unmount'){
                await page.waitForFunction(()=>!document.querySelector('.sleep-action')?.classList.contains('is-pressed'));
                assert.equal(await action.evaluate(e=>e.classList.contains('is-pressed')),false,reason+' clears pressed feedback');
              }
              else assert.equal(await action.count(),0,'unmount removes pressed UI');
            }
            for(const duration of [50,150,300,400]){
              await ready(ending?'active':'');await action.evaluate(e=>e.scrollIntoView({block:'center'}));
              await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
              const box=await action.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
              assert.equal(await action.evaluate(e=>e.classList.contains('is-pressed')),true);
              await page.clock.runFor(duration);assert.equal(await page.evaluate(()=>window.__haptics||0),0);
              await page.mouse.up();await page.clock.runFor(200);
              assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:ending?'stop':'start',minutes:0}],duration+' ms remains a normal tap');
              assert.equal(await action.evaluate(e=>e.classList.contains('is-pressed')),false);
              if(duration===400){
                // The same mounted component has now switched Awake/Sleeping.
                // Its new sleep/previous-end boundary leaves no valid five minutes.
                const next=await action.boundingBox();await page.mouse.move(next.x+next.width/2,next.y+next.height/2);await page.mouse.down();
                assert.equal(await action.evaluate(e=>e.classList.contains('is-pressed')),true);
                await page.clock.runFor(450);assert.equal(await action.evaluate(e=>e.classList.contains('is-pressed')),false);
                await page.mouse.up();await page.clock.runFor(200);assert.equal(await page.evaluate(()=>window.__sleepActions.length),1);
                assert.equal(await page.evaluate(()=>window.__haptics||0),0);
              }
              await page.clock.resume();
            }
            await ready(ending?'active':'hold-room');await action.evaluate(e=>e.scrollIntoView({block:'center'}));
            await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
            const box=await action.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
            await page.clock.runFor(449);assert.equal(await page.evaluate(()=>window.__haptics||0),0);
            await page.clock.runFor(1);assert.ok((await action.textContent()).includes('5'));assert.equal(await page.evaluate(()=>window.__haptics),1);
            for(const minutes of [10,15,20]){await page.clock.runFor(600);assert.ok((await action.textContent()).includes(String(minutes)),JSON.stringify({context,ending,minutes,text:await action.textContent()}));}
            await page.mouse.up();await page.clock.runFor(200);
            assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:ending?'stop':'start',minutes:20}]);
            assert.equal(await page.evaluate(()=>window.__haptics),4);assert.equal(await action.evaluate(e=>e.classList.contains('is-pressed')),false);
            await page.clock.resume();
            await ready(ending?'active':'');
          }
          await change.click();await page.getByRole('dialog').getByRole('button',{name:lang==='en'?'5 minutes ago':'5 minutter siden',exact:true}).click();await page.waitForTimeout(180);
          assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:ending?'stop':'start',minutes:5}]);
          await ready(ending?'active':'');await action.evaluate(e=>{e.click();e.click();});await page.waitForTimeout(180);
          assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:ending?'stop':'start',minutes:0}],'same-event-loop clicks must not duplicate writes');
          await ready(ending?'active':'');await change.click();
          await page.getByRole('dialog').getByRole('button',{name:lang==='en'?'Choose time':'Velg tidspunkt',exact:true}).click();
          const input=page.locator('input[type="datetime-local"]');
          const local=await page.evaluate(()=>{const d=new Date(Date.now()-10*60000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);});
          await input.fill(local);await page.locator('.sleep-time-sheet button[type="submit"]').click();await page.waitForTimeout(180);
          assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:ending?'stop':'start',minutes:10}]);
        }
        for(const classification of ['LONG_SLEEP_LIKE','UNCERTAIN']){
          await ready('active&classification='+classification);await page.waitForTimeout(60);
          assert.equal(await page.locator('progress,.home-wake-time').count(),0);
          const text=await page.locator('.home-sleep-insight').textContent();
          assert.equal(/Likely night sleep|Trolig natts\u00f8vn/.test(text),classification==='LONG_SLEEP_LIKE');
          await check('home-'+classification,true);
        }
        await ready('empty');assert.equal(await page.locator('.home-next-sleep').count(),0);await check('home-no-history');
        await ready('action-error');await change.click();await page.getByRole('dialog').getByRole('button',{name:lang==='en'?'Now':'Nå',exact:true}).click();
        await page.getByRole('dialog').getByRole('alert').waitFor();
        assert.ok(!/duplicate key|unique constraint/.test(await page.getByRole('dialog').textContent()));
        await check('home-failed-action',true);await page.keyboard.press('Escape');
        console.log(context+' Home checked');continue;
      }
      if(process.argv.includes('--settings-only')){
        await visit('/settings');await page.waitForSelector('.family-settings select');
        const tabs=page.getByRole('tab');
        assert.equal(await tabs.count(),4);
        assert.deepEqual(await tabs.allTextContents(),lang==='en'?['Baby','Sleep','Notifications','Account']:['Baby','S\u00f8vn','Varsler','Konto']);
        await check('settings-baby',true);
        await page.locator('.add-child-heading button').click();await check('settings-add-baby');
        await page.locator('.family-settings > .primary-button').click();await page.waitForSelector('.invitation-code');await check('settings-invitation');
        await tabs.nth(0).focus();await page.keyboard.press('ArrowRight');
        assert.equal(await tabs.nth(1).getAttribute('aria-selected'),'true');
        const toggle=page.getByRole('switch');assert.equal(await toggle.isChecked(),true);
        await check('settings-sleep',true);await toggle.uncheck();
        await page.reload();await tabs.nth(1).click();assert.equal(await toggle.isChecked(),false);
        await toggle.check();assert.equal(await toggle.isChecked(),true);
        await page.evaluate(()=>{window.__sleepyBridgeFailure=true;});
        await toggle.uncheck();await page.waitForSelector('[role="alert"]');
        assert.ok(!(await page.getByRole('alert').textContent()).includes('Synthetic'));
        await check('settings-live-activity-error',true);
        await page.evaluate(()=>{window.__sleepyBridgeFailure=false;});
        await toggle.check();await page.waitForSelector('[role="alert"]',{state:'detached'});
        assert.equal(await page.locator('.sound-settings select').count(),1);
        await tabs.nth(2).click();await page.waitForSelector('.notification-settings__card');
        assert.equal(await page.locator('.sound-settings').count(),0);
        assert.equal(await page.locator('.notification-settings__test').count(),0);
        await check('settings-notifications',true);
        await tabs.nth(3).click();await page.waitForSelector('.appearance-card');
        assert.equal(await page.getByRole('button',{name:'Norsk',exact:true}).count(),1);
        assert.equal(await page.getByRole('button',{name:'English',exact:true}).count(),1);
        assert.ok((await page.locator('.settings-about').textContent()).includes('14'));
        assert.ok(!(await page.locator('main').textContent()).includes('2.2.0'));
        await check('settings-account',true);
        await visit('/settings','error');await page.waitForSelector('.family-settings .settings-error');
        await check('settings-baby-error');
        await tabs.nth(2).click();await page.waitForSelector('.notification-settings__message');
        await page.locator('.notification-toggle input').first().click();
        await page.waitForTimeout(40);
        assert.equal(await page.locator('.notification-toggle input').first().isChecked(),true,'failed notification update must restore its prior state');
        const content=await page.locator('main').textContent();
        assert.ok(!/Synthetic|duplicate key|unique constraint|PostgreSQL/.test(content));
        await check('settings-notification-error',true);
        console.log(context+' settings checked');continue;
      }
      if(process.argv.includes('--analysis-only')){
        await visit('/analysis','probability-fixture');await page.waitForSelector('.sleep-probability-estimate');
        const probability=page.locator('.sleep-probability-card'),clock=probability.locator('input[type="time"]');
        assert.equal(await clock.inputValue(),'10:00');
        assert.match(await probability.locator('.sleep-probability-count').innerText(),/9.*12/);
        assert.match(await probability.locator('.sleep-probability-estimate').innerText(),/79/);
        await clock.fill('11:45');await clock.press('Tab');
        assert.match(await probability.locator('.sleep-probability-count').innerText(),/3.*12/);
        assert.match(await probability.locator('.sleep-probability-estimate').innerText(),/21/);
        await check('analysis-probability',true);
        await probability.locator('summary').click();await check('analysis-probability-method',true);
        await visit('/analysis','empty');await page.waitForSelector('.sleep-probability-card');
        assert.equal(await page.locator('.sleep-probability-estimate').count(),0);
        assert.match(await page.locator('.sleep-probability-count').innerText(),/0.*0/);
        await check('analysis-probability-empty',true);
        await visit('/analysis');await page.waitForSelector('.analysis-tab-content');
        for(let i=0;i<5;i++){await page.locator('.analysis-tab').nth(i).click();await check('analysis-'+i,true);}
        console.log(context+' analysis checked');continue;
      }
      await visit();await check('home',true);
      await visit('/','active&sound=listening');await check('active-sleep-sound',true);
      await visit('/history');await page.waitForSelector('.history-content');await check('history',true);
      await page.locator('button.history-content').first().focus();await page.keyboard.press('Enter');await page.waitForSelector('[role="dialog"]');await check('history-keyboard-detail');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]')),true,'modal keyboard focus escaped');
      await page.keyboard.press('Escape');await page.waitForSelector('[role="dialog"]',{state:'detached'});
      assert.equal(await page.evaluate(()=>document.activeElement.matches('button.history-content')),true,'opening control did not regain focus');
      for(const view of ['feed','sleep','newSleep','split','message']){
        await visit('/',`view=${view}`);await check(view,true);
        if(view==='feed'){for(const i of [1,2]){await page.locator('.feed-type-button').nth(i).click();await check('feed-type-'+i);}}
        if(view==='sleep'){await page.waitForSelector('.sound-activity-event');await page.locator('.sound-activity-event').first().click();await check('sound-event-detail');await page.locator('.sound-activity-list summary').click();await check('sound-event-list');}
      }
      await visit('/analysis');await page.waitForSelector('.analysis-tab-content');
      for(let i=0;i<5;i++){await page.locator('.analysis-tab').nth(i).click();await check('analysis-'+i,true);}
      await visit('/settings');await page.waitForSelector('.family-settings select');await check('settings-baby',true);
      await page.locator('.add-child-heading button').click();await check('add-child');
      await page.locator('.family-settings > .primary-button').click();await page.waitForSelector('.invitation-code');await check('invitation-code');
      for(let i=1;i<4;i++){await page.locator('.settings-tab').nth(i).click();await page.waitForTimeout(40);await check('settings-'+i,true);}
      await visit('/about');await check('about',true);
      await visit('/','view=auth');await check('auth-apple',true);
      await page.locator('.auth-link-button').first().click();await check('auth-register');
      await page.locator('.auth-tab').first().click();await page.locator('.auth-link-button').last().click();await check('auth-forgot');
      await page.evaluate(()=>window.recovery());await check('auth-reset');
      await visit('/','view=auth&web');await check('auth-web');
      await visit('/','view=onboarding');await check('onboarding-create',true);await page.locator('.onboarding-tabs button').nth(1).click();await check('onboarding-join');
      for(const [name,route,extra] of [['home-empty','/','empty'],['history-empty','/history','empty'],['analysis-empty','/analysis','empty'],
        ['sound-empty','/','view=sleep&empty'],['sound-error','/','view=sleep&error'],['settings-errors','/settings','error'],
        ['auth-loading','/','view=gate&loading'],['auth-error','/','view=gate&error'],['sound-denied','/','active&sound=blocked'],['sound-failed','/','active&sound=error'],['splash','/','view=splash']]){
        await visit(route,extra);await check(name);
      }
      // A reduced viewport approximates a raised keyboard; actual iOS keyboard
      // behavior still needs a device check, especially Safari date pickers.
      await visit('/','view=feed');await page.setViewportSize({width,height:Math.min(height,400)});
      await page.locator('textarea').focus();await page.locator('textarea').scrollIntoViewIfNeeded();await check('keyboard-viewport');
      await page.setViewportSize({width,height});
      console.log(context+' checked');
    }
    // Chromium's safe-area emulation exercises the actual env() declarations.
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:44,bottom:34,left:0,right:0}});
    context='390x844-safe-areas';query='lang=no&theme=dark';await page.setViewportSize({width:390,height:844});
    await visit();await check('home');
    assert.ok(await page.locator('.home-header').evaluate(e=>e.getBoundingClientRect().top+scrollY>=44));
    assert.ok(await page.locator('.bottom-nav').evaluate(e=>parseFloat(getComputedStyle(e).paddingBottom)>=34));
    await visit('/','view=feed');await check('modal');
    assert.ok(await page.locator('.feed-modal').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=44&&r.bottom<=innerHeight-34}));
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({screens,failures,errors},null,2));
    const skin=(process.argv.find(value=>value.startsWith('--skin='))||'--skin=default').split('=')[1];
    fs.writeFileSync(path.join(output,`report-${skin}-${process.argv.includes('--quick')?'quick':requestedWidth||'full'}.json`),JSON.stringify({screens,failures,errors},null,2));
    assert.deepEqual(errors,[],'browser runtime errors');
    assert.deepEqual(failures,[],'layout failures; inspect '+path.join(output,'report.json'));
    console.log(`${screens.length} screen/state checks passed. Screenshots/report: ${output}. External network blocked.`);
  } finally { if(browser)await browser.close();server.kill(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
