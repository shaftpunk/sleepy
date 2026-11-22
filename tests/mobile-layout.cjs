/* Real React screens, synthetic data and blocked external requests. No app/API
   writes. Pass an existing Playwright module; no production dependency needed:
   node tests/mobile-layout.cjs <playwright module path> [--quick]
   SLEEPY_CHROMIUM_PATH can select an already installed Chromium executable. */
const assert = require('node:assert/strict');
const logOnly = ['--log-only', '--history-only', '--diaper-history'].some(flag => process.argv.includes(flag));
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
import SleepWave from '/src/components/sleep-wave/SleepWaveCard.tsx';import App from '/src/App.tsx';import Auth from '/src/pages/Auth.tsx';import Onboarding from '/src/pages/Onboarding.tsx';
import AuthGate from '/src/components/AuthGate.tsx';import Splash from '/src/components/SplashScreen.tsx';
import FeedModal from '/src/components/FeedModal.tsx';import SleepModal from '/src/components/SleepModal.tsx';
import Split from '/src/components/SleepSplitModal.tsx';import Message from '/src/components/FamilyMessageModal.tsx';
import {useAppStore} from '/src/stores/appStore.ts';import {useSoundStore} from '/src/stores/soundStore.ts';
import {HouseholdContextProvider,useHouseholdContext} from '/src/households/HouseholdContextProvider.tsx';
import {EntitlementProvider,useEntitlements} from '/src/entitlements/EntitlementProvider.tsx';
import HouseholdContextSelector from '/src/households/HouseholdContextSelector.tsx';
import '/src/index.css';import '/src/themes/alive/alive.css';import '/src/themes/outrun/outrun.css';
const p=new URLSearchParams(location.search),view=p.get('view'),theme=p.get('theme')||'dark';
document.documentElement.dataset.visualTheme=p.get('skin')||'default';
const baby={id:'baby',name:p.has('long')?'Amalie Alexandra Strande Engevik':'Amalie',birth_date:'2026-08-03'};
useAppStore.setState({language:p.get('lang')||'no',theme,visualTheme:p.get('skin')||'default',currentBabyId:'baby',currentBbyId:'fixture-baby',babies:[baby,{...baby,id:'baby-2',name:'Alexander'}]});
useSoundStore.setState({enabled:!!p.get('sound'),sensitivity:'medium'});
if(p.has('wave-fixture')||p.has('log-fixture'))window.__waveStore=useAppStore;
const sleep={id:'sleep',baby_id:'baby',starttime:new Date(Date.now()-12*3600000).toISOString(),endtime:new Date(Date.now()-2*3600000).toISOString(),durationminutes:600,rate:'5',deleted_at:null,note:'Testnotat / a synthetic note'};
const onset=new Date();onset.setHours(14,25,0,0);const peak=onset.getTime(),onsetNow=peak-3600000;
const onsetView=React.createElement('main',{className:'home-page'},React.createElement(SleepWave,{sessions:[],active:null,now:onsetNow,
  prediction:{status:'ready',earliestStart:peak-1800000,latestStart:peak+1800000,sampleSize:12,peak:{peakTime:peak,windowStart:peak-900000,windowEnd:peak+900000}}}));
const done=()=>{};const views={onset:onsetView,auth:React.createElement(Auth),onboarding:React.createElement(Onboarding,{onComplete:async()=>{}}),
gate:React.createElement(AuthGate,null,'Ready'),splash:React.createElement(Splash),
feed:React.createElement(FeedModal,{onClose:done,onSaved:done}),sleep:React.createElement(SleepModal,{sleep,onClose:done,onSaved:done}),
newSleep:React.createElement(SleepModal,{onClose:done,onSaved:done}),split:React.createElement(Split,{sleep,onClose:done,onSaved:done}),
message:React.createElement(Message,{babyId:'baby',babyName:baby.name,onClose:done})};
function Probe(){const h=useHouseholdContext(),e=useEntitlements();window.__probe={h,e};window.__setBaby=id=>useAppStore.setState({currentBabyId:id});return React.createElement('main',null,React.createElement(HouseholdContextSelector),React.createElement('output',{id:'probe'},JSON.stringify({user:h.userId,baby:h.babyId,household:h.householdId,loading:e.loading,tier:e.tier,isPlus:e.isPlus,verification:e.verificationState,canUse:e.canUse('family'),wouldAllow:e.wouldAllow('family')})));}
const wrapped=child=>React.createElement(HouseholdContextProvider,null,React.createElement(EntitlementProvider,null,child));
if(view==='analysis')views.analysis=wrapped(React.createElement((await import('/src/pages/Analysis.tsx')).default));
DOM.createRoot(document.getElementById('root')).render(view==='entitlements'?wrapped(React.createElement(Probe)):view?React.createElement('div',{'data-theme':theme},views[view]):wrapped(React.createElement(App)));`;
const params = `const p=new URLSearchParams(location.search);`;
const records = `${params}const now=Date.now(),iso=n=>new Date(n).toISOString();const sleeps=p.has('empty')?[]:Array.from({length:35},(_,i)=>({id:i?'sleep-'+i:'sleep',baby_id:'baby',starttime:iso(now-(i*24+12)*3600000),endtime:iso(now-(i*24+2)*3600000),durationminutes:600,sleep_type:'sleep',rate:'5',deleted_at:null,note:p.has('long')?'Et langt notat som skal være lesbart på små skjermer. '+ 'x'.repeat(65):'A short note'}));const feeds=p.has('empty')?[]:Array.from({length:5},(_,i)=>({id:'feed-'+i,baby_id:'baby',feedtype:['bottle','breast','food'][i%3],amountml:120,side:'left',starttime:iso(now-i*7200000),note:'A synthetic feeding note'}));`;
const failure = `const blocked=async()=>{throw Error('duplicate key value violates unique constraint synthetic_settings_test')};`;
function mock(url) {
  if(process.argv.includes('--entitlements-only')&&url==='/src/auth/AuthProvider.tsx')return `import React from '/node_modules/.vite/deps/react.js';const {useSyncExternalStore}=React;let user='user';const listeners=new Set();window.__setUser=id=>{user=id;for(const f of listeners)f()};export const useAuth=()=>{const id=useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>user);return {user:id?{id}:null,loading:false}};`;
  if(url.endsWith('/householdContextService.ts'))return `${params}export async function getHouseholdCandidates(user,baby){await new Promise(r=>setTimeout(r,window.__contextDelay||0));if(window.__contextFailure)throw Error('Synthetic offline');return window.__candidates||(p.has('multiple')?[{id:'A',name:'Household A',role:'viewer'},{id:'B',name:'Household B',role:'parent'}]:[{id:'household',name:'Synthetic household',role:'owner'}])};export const subscribeHouseholdContext=()=>()=>{};`;
  if(url.endsWith('/entitlementService.ts'))return `import features from '/src/entitlements/features.json';export async function resolveHouseholdEntitlements(householdId){const tier=window.__tier||(new URLSearchParams(location.search).has('plus-entitled')?'plus':'free'),delay=window.__resolutionDelay||0;await new Promise(r=>setTimeout(r,delay));if(window.__resolutionFailure)throw Error('Synthetic unavailable RPC');return {householdId,tier,isPlus:tier==='plus',features:Object.keys(features).filter(f=>tier==='plus'||features[f].requiredTier==='free'),verificationState:'verified',verifiedAt:new Date().toISOString(),validUntil:null,recheckAt:new Date(Date.now()+300000).toISOString(),policyVersion:1}};`;
  if (url === '/src/auth/AuthProvider.tsx') return `${params}export const useAuth=()=>({user:{id:'user',email:'parent.with.a.long.synthetic.email@example.invalid',user_metadata:{full_name:'Alexandra Strande Engevik'}},session:{user:{id:'user'}},loading:p.has('loading'),signOut:async()=>{window.__signedOut=true;}});`;
  if (url === '/src/services/diaperService.ts' && (logOnly||process.argv.includes('--today-summary')||process.argv.includes('--minimal-home'))) return `
    export const diaperTypes=['wet','dirty','both'];
    export async function countDiaperChangesBetween(...args){window.__diaperCountQuery=args;return new URLSearchParams(location.search).has("empty")?0:5;}
    const rows=[['wet','10:00','baby'],['dirty','09:00','baby'],['both','11:00','baby'],['other','11:30','another']];
    export async function getRecentDiaperChanges(babyId,limit){
      if(babyId!=='baby')return [];
      if(limit===1){
        if(new URLSearchParams(location.search).has('empty'))return [];
        return [window.__savedDiaper||{id:'both',type:'both',baby_id:babyId,changed_at:'2026-11-21T11:00:00Z'}];
      }
      return [...rows.map(([id,time,baby_id])=>({id,type:id,baby_id,changed_at:'2026-11-21T'+time+':00Z'})),
        {id:'yesterday',type:'wet',baby_id:'baby',changed_at:'2026-11-20T18:00:00Z'}];
    }
    const daily=rows.slice(0,3).map(([id,time,baby_id])=>({id,type:id,baby_id,changed_at:'2026-11-21T'+time+':00Z'}));
    daily.push({id:'old',type:'both',baby_id:'baby',changed_at:'2026-10-24T11:00:00Z'});
    export const getDiaperChangesBetween=async(id,from,to)=>daily.filter(row=>row.baby_id===id&&row.changed_at>=from&&row.changed_at<to);
    export async function updateDiaperChange(...args){window.__updatedDiaper=args;const row=daily.find(row=>row.id===args[0]);if(row)Object.assign(row,{type:args[2],changed_at:args[3]});}
    export async function deleteDiaperChange(...args){window.__deletedDiaper=args;const index=daily.findIndex(row=>row.id===args[0]);if(index>=0)daily.splice(index,1);}
    export async function createDiaperChange(babyId,type,changedAt){window.__savedDiaper={id:"new",baby_id:babyId,type,changed_at:changedAt};daily.push(window.__savedDiaper);}
  `;
  if (url === '/src/lib/supabase.ts') return `export const supabase={from(table){return {select(){let baby,start;return {eq(_,id){baby=id;return this;},order(){return this;},async limit(){return {data:[],error:null};},gte(_,value){start=value;return this;},lt(_,end){window.__diaperCountQuery=[baby,start,end];return {count:5,error:null,order(){return this;},async range(){return {data:[],error:null};}};}};},insert(row){return {select(){return {async single(){if(table!=='diaper_changes')throw Error(table);window.__diaperRows??=[];window.__diaperRows.push(row);return {data:row,error:null};}};}};} };},auth:{onAuthStateChange:f=>{window.recovery=()=>f('PASSWORD_RECOVERY');return {data:{subscription:{unsubscribe(){}}}}},getUser:async()=>({data:{user:{id:'user'}}})}};`;
  if (url === '/src/services/sleepService.ts') return records + failure + `
    if(p.has('probability-fixture')){const at=(days,h,m=0)=>{const d=new Date();d.setDate(d.getDate()-days);d.setHours(h,m,0,0);return d.getTime()};const row=(start,end)=>({id:String(start),baby_id:'baby',starttime:iso(start),endtime:iso(end),durationminutes:(end-start)/60000,sleep_type:'sleep',rate:'4',deleted_at:null});sleeps.splice(0,sleeps.length,...Array.from({length:12},(_,i)=>{const d=i+1;return [row(at(d+1,23,30),at(d,7)),row(at(d,d<=9?9:11,30),at(d,d<=9?10:12,30)),row(at(d,20),at(d,21))]}).flat());}
    if(p.has('next-sleep-fixture')&&!p.has('empty')){sleeps.splice(0,sleeps.length,...Array.from({length:12},(_,d)=>Array.from({length:6},(_,i)=>{const end=now-(d+1)*86400000-i*4*3600000;return {id:String(end),baby_id:'baby',starttime:iso(end-3600000),endtime:iso(end),durationminutes:60,sleep_type:'sleep',rate:'4',deleted_at:null}})).flat(),{id:'last',baby_id:'baby',starttime:iso(now-2*3600000),endtime:iso(now-3600000),durationminutes:60,sleep_type:'sleep',rate:'4',deleted_at:null});sleeps.sort((a,b)=>Date.parse(b.endtime)-Date.parse(a.endtime));}
    if(p.has('wave-fixture')&&!p.has('empty')){const at=(d,h,m=0)=>{const date=new Date(now);date.setDate(date.getDate()-d);date.setHours(h,m,0,0);return date.getTime()};const row=(start,end)=>({id:String(start),baby_id:'baby',starttime:iso(start),endtime:iso(end),durationminutes:(end-start)/60000,sleep_type:'sleep',rate:'4',deleted_at:null});sleeps.splice(0,sleeps.length,...Array.from({length:12},(_,i)=>{const d=i+1;return [row(at(d+1,22),at(d,6)),row(at(d,9,15),at(d,10,5)),row(at(d,12,55),at(d,13,35)),row(at(d,16,10),at(d,16,50)),row(at(d,p.has('multi')?18:20),at(d,p.has('multi')?19:21))]}).flat(),...(p.has('multi')?[]:[row(at(0,9,15),at(0,10,5))]),...(p.has('night')?[row(at(1,20,9),at(0,6,53))]:[]));sleeps.sort((a,b)=>Date.parse(b.endtime)-Date.parse(a.endtime));}
    if(p.has('home-fixture')&&!p.has('empty')){sleeps.splice(0,sleeps.length,...Array.from({length:24},(_,i)=>({...sleeps[0],id:'history-'+i,baby_id:'baby',starttime:iso(now-(63+i*120)*60000),endtime:iso(now-(18+i*120)*60000),durationminutes:45,sleep_type:'sleep',rate:'4.8',deleted_at:null})));}
    if(p.has('last-slept-fixture')&&sleeps[0])Object.assign(sleeps[0],{starttime:iso(now-223*60000),endtime:iso(now-151*60000),durationminutes:72});
    export const getActiveSleep=async()=>window.__homeActive!==undefined?window.__homeActive:p.has('active')?{...sleeps[0],id:'active',baby_id:'baby',sleep_type:'sleep',starttime:p.has('wave-fixture')||p.has('home-fixture')||p.has('last-slept-fixture')?iso(now-42*60000):sleeps[0].starttime,endtime:null}:null,
    getLastCompletedSleep=async()=>window.__homeLast||(p.has('hold-room')?{...sleeps[0],endtime:iso(now-2*3600000)}:sleeps[0])||null,getRecentSleeps=async()=>sleeps.slice(0,8),getAllSleeps=async()=>sleeps,getSleepsFromDate=async()=>sleeps,getSleepsOverlappingPeriod=async(id,from,to)=>p.has("log-fixture")?[...sleeps,{...sleeps[0],id:"overnight",starttime:"2026-11-20T22:40:00.000Z",endtime:"2026-11-21T00:20:00.000Z",durationminutes:100},{...sleeps[0],id:"active",starttime:window.__logActiveStart??"2026-11-21T17:00:00.000Z",endtime:null}].filter(row=>row.baby_id===id&&row.starttime<to&&(!row.endtime||row.endtime>from)):window.__waveRows??sleeps;
    export async function startSleep(babyId,minutes=0){if(!p.has('home-actions'))return blocked();(window.__sleepActions??=[]).push({kind:'start',minutes});if(p.has('action-error'))return blocked();await new Promise(r=>setTimeout(r,100));return window.__homeActive={...sleeps[0],id:'started',baby_id:babyId,starttime:iso(Date.now()-minutes*60000),endtime:null};}
    export async function stopSleep(id,start,minutes=0){if(!p.has('home-actions'))return blocked();(window.__sleepActions??=[]).push({kind:'stop',minutes});if(p.has('action-error'))return blocked();await new Promise(r=>setTimeout(r,100));window.__homeActive=null;return window.__homeLast={...sleeps[0],id,starttime:start,endtime:iso(Date.now()-minutes*60000)};}
    export async function updateActiveSleepStart(row,starttime){if(p.has('log-fixture')){window.__logActiveStart=starttime;return;}if(!p.has('home-refinement'))return blocked();window.__homeActive={...row,starttime};window.__corrected=row.id;}
    export async function updateSleep(id,starttime,endtime,rate){if(!p.has("recent-edit")&&!p.has("log-fixture"))return blocked();const row=sleeps.find(row=>row.id===id);Object.assign(row,{starttime,endtime,rate,durationminutes:(Date.parse(endtime)-Date.parse(starttime))/60000});(window.__editedSleeps??=[]).push(id);}
    export {blocked as resumeSleep};
    export async function deleteSleep(id){if(!p.has("log-fixture"))return blocked();sleeps.splice(sleeps.findIndex(row=>row.id===id),1);}
    export async function splitSleep(id,at){if(!p.has("log-fixture"))return blocked();const row=sleeps.find(row=>row.id===id);sleeps.push({...row,id:id+"-split",starttime:at});row.endtime=at;}
    export async function createManualSleep(row){if(!p.has("log-fixture"))return blocked();sleeps.push({...row,id:"new-sleep"});}`;
  if(url.endsWith('/sleepEstimateService.ts')&&process.argv.includes('--home-only'))return params+`export const getActiveSleepEstimate=async sleep=>({classification:p.get('classification')||'SHORT_SLEEP_LIKE',estimatedWakeTime:!p.has('classification')||p.get('classification')==='SHORT_SLEEP_LIKE'?new Date(Date.parse(sleep.starttime)+57*60000).toISOString():null}),sleepEstimateHistoryRevision=()=>0,subscribeSleepEstimateHistory=()=>()=>{},publishSleepEstimateHistory=()=>{};`;
  if (url === '/src/services/feedService.ts') return records + failure + `if(p.has("log-fixture"))window.__logFeeds=feeds;export async function countFeedsBetween(...args){window.__feedCountQuery=args;return p.has("empty")?0:4;} export const getLastFeed=async()=>feeds[0]||null,getRecentFeeds=async()=>feeds,getFeedsFromDate=async()=>feeds,getFeedsBetween=async(id,from,to)=>feeds.filter(row=>row.baby_id===id&&row.starttime>=from&&row.starttime<to);export async function createFeed(row){if(!p.has("log-fixture"))return blocked();feeds.push({...row,id:"new-feed"});}
export async function updateFeed(id,row){if(!p.has("log-fixture"))return blocked();Object.assign(feeds.find(record=>record.id===id),row);}
export async function deleteFeed(id){if(!p.has("log-fixture"))return blocked();feeds.splice(feeds.findIndex(row=>row.id===id),1);}`;
  if (url.endsWith('/sleepRealtime.ts')) return `export const subscribeToSleepChanges=()=>()=>{};`;
  if (url.endsWith('/feedRealtime.ts')) return `export const subscribeToFeedChanges=(_id,refresh)=>{window.__feedRefresh=refresh;return ()=>{};};`;
  if (url.endsWith('/householdService.ts')) return params + failure + `export async function getMyHouseholds(){if(p.has('error'))throw Error('Synthetic long failure message. '+ 'x'.repeat(70));return [{id:'household',name:'Strande Engevik – familie med et langt navn',role:'owner'}]};export const getMyBabies=async()=>[];export const getHouseholdMemberRoles=async()=>['owner','parent','viewer'];export {blocked as updateBabyBirthDate,blocked as createBabyForHousehold,blocked as createHouseholdWithBaby};`;
  if (url.endsWith('/invitationService.ts')) return `export const createHouseholdInvitation=async()=>({token:'synthetic-layout-only-'+ 'A'.repeat(65),expires_at:new Date().toISOString()}),acceptHouseholdInvitation=async()=>({household_name:'Synthetic family'});`;
  if (url.endsWith('/pushService.ts')) return `export const hasPushSubscription=async()=>true,attributePushSubscription=async()=>{},enablePushNotifications=async()=>{},disablePushNotifications=async()=>{},sendTestNotification=async()=>{};`;
  if (url.endsWith('/nativePushService.ts')) return params+`export const isNativeIOS=()=>true,nativePushState=()=>p.has('denied')?'denied':'enabled',subscribeNativePush=()=>()=>{};`;
  if (process.argv.includes('--settings-only')) {
    if(url.endsWith('/predictionReminder.ts')) return params+ `export const preferenceChanged='reminder-fixture', reminderAvailable=()=>true, reminderKey=(user,baby)=>'fixture:'+user+':'+baby, requestReminderPermission=async()=>!p.has('denied'), reconcileReminder=async()=>{};`;
    if(url.endsWith('/PurchaseEvidenceContext.tsx')) return  `export const usePurchaseEvidence=()=>({status:'none',refreshedAt:'fixture'});`;
    if(url.endsWith('/revenueCatService.ts')) return params+ `export const revenueCatAvailable=()=>true;export const getRevenueCatOffering=async()=>{if(p.has('missing-offering'))throw Error('internal code');return {availablePackages:[{identifier:'$rc_monthly',product:{priceString:'49 kr'}},{identifier:'$rc_annual',product:{priceString:'399 kr'}}]};};export const refreshRevenueCatState=async()=>{},reconcileRevenueCatState=async()=>({state:'verified'}),getRevenueCatDiagnostics=async()=>null,purchaseRevenueCatPackage=async()=>({status:'cancelled',issue:null}),restoreRevenueCatPurchases=async()=>{window.__restored=true;return {status:'restored',issue:null,reconciliation:{state:'sandboxVerified'}};};`;
  }
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
    const page = await browser.newPage({timezoneId:'Europe/Oslo'});
    if (logOnly) await page.clock.setFixedTime(new Date('2026-11-21T18:00:00Z'));
    if(process.argv.includes('--sleep-wave-only')||process.argv.includes('--analysis-only'))await page.clock.install({time:new Date('2026-11-16T11:08:00Z')});
    // Home fixtures are relative to "now", but Today stats count sessions that
    // started after local midnight: on the real clock the quality assertion
    // failed between 00:00 and ~01:03 Oslo. A fixed midday start (time still
    // flows, so hold gestures behave normally) makes every run deterministic.
    if(process.argv.includes('--home-only')||process.argv.includes('--home-refinement'))await page.clock.install({time:new Date('2026-11-16T11:08:00Z')});
    if(process.argv.includes('--today-summary'))await page.clock.setFixedTime(new Date('2026-11-21T12:00:00Z'));
    if(process.argv.includes('--last-slept-only'))await page.clock.setFixedTime(new Date('2026-11-16T11:08:00Z'));
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
    if (process.argv.includes('--shell-insets')) {
      const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
      assert.equal(config.ios.contentInset, 'never');
      const cdp = await page.context().newCDPSession(page);
      for (const width of [320,375,390,430,1024]) {
        await page.setViewportSize({width,height:844});
        for (const top of [0,59]) {
          const bottom = top ? 34 : 0;
          await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top,bottom,left:0,right:0}});
          for (const route of ['/','/history','/analysis','/settings']) {
            await page.goto(base+route+'?lang=en');
            await page.waitForSelector('.app-shell > main');
            const metrics = await page.evaluate(()=>{
              const main = document.querySelector('.app-shell > main');
              const nav = document.querySelector('.bottom-nav');
              return {
                header:main.firstElementChild.getBoundingClientRect().top+scrollY,
                start:main.getBoundingClientRect().top+scrollY,
                navPadding:parseFloat(getComputedStyle(nav).paddingBottom),
                navBottom:nav.getBoundingClientRect().bottom,
              };
            });
            const expected = top+(width<=430?8:24);
            assert.equal(metrics.start,expected,route+' main');
            assert.equal(metrics.header,expected,route+' header');
            assert.equal(metrics.navPadding,12+bottom);
            assert.equal(metrics.navBottom,844);
          }
        }
      }
      console.log('40 shell measurements passed');
      return;
    }
    const requestedWidth=process.argv.find(value=>value.startsWith('--width='))?.split('=')[1];
    const sizes = (process.argv.includes('--quick') ? [[320,568]] : (process.argv.includes('--sleep-wave-only')||process.argv.includes('--analysis-only')?[[320,568],[360,780],[375,667],[390,844],[430,932]]:[[320,568],[375,667],[390,844],[430,932]]))
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
      if (process.argv.includes('--onset-display')) {
        await visit('/','view=onset');
        const card=page.locator('.sleep-wave');
        assert.equal(await card.locator('.sleep-wave-time').innerText(),'14:25');
        assert.match(await card.locator('.sleep-wave-caption').innerText(),/14:10.*14:40/);
        assert.ok(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
        await check('onset-display');
        continue;
      }
      if (process.argv.includes('--today-summary')) {
        await visit('/','home-fixture');
        const today=page.locator('.today-stats');
        const feed=today.locator('a[href$=feed]'), diaper=today.locator('a[href$=diaper]');
        await page.waitForFunction(()=>document.querySelector('.today-stats a[href$=diaper]')?.textContent.includes('5'));
        assert.equal(await feed.textContent(),lang==='en'?'4 feeds':'4 matinger');
        assert.equal(await diaper.textContent(),lang==='en'?'5 diapers':'5 bleier');
        const expected=['baby','2026-11-20T23:00:00.000Z','2026-11-21T23:00:00.000Z'];
        assert.deepEqual(await page.evaluate(()=>window.__feedCountQuery),expected);
        assert.deepEqual(await page.evaluate(()=>window.__diaperCountQuery),expected);
        const layout=await today.locator('a').evaluateAll(nodes=>nodes.map(node=>({w:node.offsetWidth,h:node.offsetHeight,overflow:node.scrollWidth>node.clientWidth})));
        assert.ok(layout.slice(1).every(item=>item.h<layout[0].h && item.w<layout[0].w));
        assert.ok(layout.every(item=>!item.overflow));
        const lastDiaper=page.locator('[aria-labelledby="home-last-diaper"]');
        assert.equal(await lastDiaper.evaluate(e=>e.previousElementSibling.querySelector('.card-label').textContent.trim()),lang==='en'?'Last fed':'Sist matet');
        await lastDiaper.locator('.home-edit').waitFor();
        assert.match(await lastDiaper.locator('.muted').innerText(),lang==='en'?/Wet \+ Dirty/:/Tiss \+ b\u00e6sj/);
        await lastDiaper.locator('.home-edit').click();
        const editor=page.locator('.diaper-modal');
        assert.equal(await editor.locator('[aria-pressed=true]').count(),1);
        await page.keyboard.press('Escape');
        await lastDiaper.locator('.secondary-button').click();
        await editor.locator('.diaper-types button').first().click();
        await editor.locator('[type=submit]').click();
        await editor.waitFor({state:'hidden'});
        await page.waitForFunction(()=>document.querySelector('[aria-labelledby=home-last-diaper] .muted')?.textContent.includes('13:00'));
        await check('today-summary');
        for(const kind of ['sleep','feed','diaper']){
          await today.locator('a[href$='+kind+']').click();
          await page.waitForSelector('#history-sessions');
          assert.ok(page.url().endsWith('today='+kind));
          if(kind==='diaper') await page.waitForSelector('#history-sessions [data-diaper-change]');
          if(kind==='feed') await page.waitForSelector('#history-sessions .history-content');
          await visit('/','home-fixture');
        }
        await visit('/','empty');
        assert.equal(await lastDiaper.locator('.home-edit').count(),0);
        await check('today-summary-empty');
        continue;
      }
      if (process.argv.includes('--quick-actions')) {
        await visit('/','home-actions');
        const actions=page.locator('.home-quick-actions .home-sleep-actions');
        const sleep=actions.locator('.sleep-action');
        const secondary=actions.locator('.secondary-button');
        await sleep.waitFor();
        const widths=await actions.locator('.sleep-action,.secondary-button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));
        assert.equal(widths.length,3);
        assert.ok(Math.max(...widths)-Math.min(...widths)<1);
        assert.deepEqual(await secondary.allTextContents(),lang==='en'?['Diaper','Feed']:['Bleie','Mating']);
        assert.equal(await sleep.evaluate(e=>e.previousElementSibling.textContent.trim()),lang==='en'?'Feed':'Mating');
        const icons = await actions.locator('button > svg').evaluateAll(nodes => nodes.map(node => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return { width: rect.width, height: rect.height, strokeWidth: style.strokeWidth, stroke: style.stroke };
        }));
        assert.equal(icons.length, 3);
        for (const icon of icons) {
          assert.equal(icon.width, 16);
          assert.equal(icon.height, 16);
          assert.equal(icon.strokeWidth, '1.5px');
          assert.notEqual(icon.stroke, 'none');
        }
        await check('quick-actions-awake');
        await secondary.last().click();
        await page.waitForSelector('[role=dialog]');
        await page.keyboard.press('Escape');
        await secondary.first().click();
        const diaper=page.locator('.diaper-modal');
        await check('diaper-dialog');
        await diaper.locator('.diaper-types button').last().click();
        await diaper.locator('input').fill('2026-11-21T10:30');
        await diaper.locator('[type=submit]').click();
        await diaper.waitFor({state:'hidden'});
        assert.deepEqual(await page.evaluate(()=>window.__diaperRows),[{baby_id:'baby',type:'both',changed_at:'2026-11-21T09:30:00.000Z'}]);
        await sleep.click();
        await secondary.first().waitFor({state:'hidden'});
        assert.equal(await page.locator('.sleep-action').count(),1);
        assert.equal(await actions.evaluate(e=>e.getBoundingClientRect().width),await sleep.evaluate(e=>e.getBoundingClientRect().width));
        await check('quick-actions-sleeping');
        await sleep.click();
        await secondary.first().waitFor();
        assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:'start',minutes:0},{kind:'stop',minutes:0}]);
        continue;
      }
      if (process.argv.includes('--last-slept-only')) {
        const card = page.locator('section[aria-labelledby="home-last-slept"]');
        const register = card.getByRole('button', { name: lang === 'en' ? 'Register' : 'Registrer' });
        const visitHome = async (state = '') => {
          await visit('/', 'last-slept-fixture&' + state);
          await page.locator('.home-sleep-actions > button:enabled').first().waitFor();
        };
        const expectCompletedSleep = async () => {
          assert.equal(await card.locator('.card-label').textContent(), lang === 'en' ? 'Last slept' : 'Sist sovet');
          assert.equal(await card.locator('h2').evaluate(e=>e.querySelector('button')?.firstChild.textContent.trim() ?? e.textContent), lang === 'en' ? '2h 31m ago' : '2t 31m siden');
          assert.deepEqual(await card.locator('.muted').allTextContents(), [
            lang === 'en' ? 'Slept 1h 12m' : 'Sov 1t 12m', '08:25\u201309:37',
          ]);
        };
        await visitHome();
        await expectCompletedSleep();
        assert.equal(await page.locator('.sleep-strip').count(), 0);
        const layout = await card.evaluate(sleep => {
          const today = sleep.previousElementSibling;
          const feed = sleep.nextElementSibling;
          const rect = element => element.getBoundingClientRect();
          const style = getComputedStyle(sleep);
          return {
            adjacent: today.matches('.home-today') && feed.matches('.feed-card'),
            todayGap: rect(sleep).top - rect(today).bottom,
            feedGap: rect(feed).top - rect(sleep).bottom,
            pageGap: parseFloat(getComputedStyle(sleep.parentElement).rowGap),
            equalStyles: ['padding', 'border', 'borderRadius', 'background', 'flexDirection']
              .every(property => style[property] === getComputedStyle(feed)[property]),
            aligned: ['', 'div', '.secondary-button'].every(selector => {
              const a = rect(selector ? sleep.querySelector(selector) : sleep);
              const b = rect(selector ? feed.querySelector(selector) : feed);
              return a.left === b.left && a.right === b.right;
            }),
          };
        });
        assert.ok(layout.adjacent && layout.equalStyles && layout.aligned, JSON.stringify(layout));
        assert.equal(layout.todayGap, layout.pageGap);
        assert.equal(layout.feedGap, layout.pageGap);
        await check('last-slept', true);

        await visitHome('active');
        assert.ok((await page.locator('.sleep-wave [data-wave-live]').textContent()).includes('42'));
        await expectCompletedSleep();
        await check('last-slept-active');

        await visitHome('empty&active');
        assert.equal(await card.locator('h2').textContent(), lang === 'en' ? 'No sleep recorded yet' : 'Ingen s\u00f8vn registrert enn\u00e5');
        assert.equal(await card.locator('.muted').count(), 0);
        await check('last-slept-empty');
        await register.click();
        const dialog = page.getByRole('dialog', { name: lang === 'en' ? 'Add sleep' : 'Legg til s\u00f8vn' });
        await dialog.waitFor();
        assert.equal(await dialog.locator('input[type="datetime-local"]').count(), 2);
        await check('last-slept-register');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        console.log(context + ' Last slept checked');
        continue;
      }
      if(process.argv.includes('--sleep-wave-only')){
        const card=page.locator('.sleep-wave');
        await visit('/','wave-fixture');await page.waitForSelector('.sleep-wave-time');
        assert.equal(await card.getAttribute('data-wave-state'),'ready');
        assert.equal(await card.locator('[data-wave-forecast]').count(),1);
        assert.equal(await card.locator('svg').count(),1);
        assert.equal(await card.evaluate(e=>e.previousElementSibling.classList.contains('home-live-state')),true);
        const start=page.locator('.home-sleep-actions > .sleep-action');
        await page.evaluate(()=>window.scrollTo(0,0));
        assert.ok(await start.evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight-70),'tracking action remains above the fold');
        assert.equal(await card.locator('.sleep-wave-chart').getAttribute('aria-hidden'),'true');
        const ticks=await card.locator('.sleep-wave-axis > span').evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}}));
        for(let i=1;i<ticks.length;i++)assert.ok(ticks[i].left>=ticks[i-1].right-1,'axis labels overlap');
        await check('sleep-wave-ready',true);
        // Secondary copy sits behind the info toggle; it stays in the DOM for screen readers.
        const info=card.locator('.sleep-wave-info-button'),panel=card.locator('.sleep-wave-info');
        assert.equal(await info.getAttribute('aria-expanded'),'false');assert.ok((await panel.textContent()).length>20,'info text available to assistive technology');
        assert.ok(await panel.evaluate(e=>e.getBoundingClientRect().height<=1),'info panel visually hidden when closed');
        await info.click();assert.equal(await info.getAttribute('aria-expanded'),'true');assert.ok(await panel.evaluate(e=>e.getBoundingClientRect().height>20));
        await check('sleep-wave-info',true);await info.click();assert.equal(await info.getAttribute('aria-expanded'),'false');
        await page.emulateMedia({reducedMotion:'reduce'});
        assert.equal(await card.locator('.sleep-wave-now-marker').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
        await page.evaluate(()=>document.documentElement.style.fontSize='200%');
        const largeText=await card.evaluate(e=>({overflow:e.scrollWidth>e.clientWidth+1,range:e.querySelector('.sleep-wave-time').scrollWidth>e.querySelector('.sleep-wave-time').clientWidth+1}));
        assert.deepEqual(largeText,{overflow:false,range:false});
        const largeTicks=await card.locator('.sleep-wave-axis > span').evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}}));
        for(let i=1;i<largeTicks.length;i++)assert.ok(largeTicks[i].left>=largeTicks[i-1].right-1,'large-text axis labels overlap');
        await card.screenshot({path:path.join(output,context+'-sleep-wave-large-text.png')});screens.push(context+'/sleep-wave-large-text');
        await page.evaluate(()=>document.documentElement.style.fontSize='');await page.emulateMedia({reducedMotion:'no-preference'});
        await page.evaluate(()=>window.__waveStore.setState({currentBabyId:'baby-2'}));
        await page.waitForSelector('.sleep-wave[data-wave-state="insufficient_data"]');
        assert.equal(await card.locator('[data-wave-forecast],.sleep-wave-recorded').count(),0);
        await page.evaluate(()=>window.__waveStore.setState({currentBabyId:'baby'}));await page.waitForSelector('.sleep-wave-time');
        await page.evaluate(()=>{window.__waveRows=[];window.dispatchEvent(new Event('sleepy:sleep-presentation-changed'))});
        await page.waitForSelector('.sleep-wave[data-wave-state="insufficient_data"]');
        assert.equal(await card.locator('[data-wave-forecast],.sleep-wave-recorded').count(),0);
        await check('sleep-wave-deleted-history',true);
        await visit('/','wave-fixture&active');await page.waitForSelector('[data-wave-active]');
        assert.equal(await card.getAttribute('data-wave-state'),'sleeping');assert.equal(await card.locator('[data-wave-forecast]').count(),0);
        await page.evaluate(()=>window.scrollTo(0,0));
        assert.ok(await page.locator('.home-sleep-actions > .sleep-action').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight-70),'stop action remains above the fold');
        await page.waitForSelector('[data-wave-predicted="1"]');
        assert.ok((await card.locator('.sleep-wave-accessible-history').innerText()).includes('15:'), 'first active continuation has accessible timing');
        await check('sleep-wave-sleeping',true);
        await page.clock.setFixedTime(new Date('2026-11-16T08:40:00Z'));
        await visit('/','wave-fixture&active&multi');await page.waitForSelector('[data-wave-predicted="3"]');
        assert.equal(await card.locator('[data-wave-predicted]').count(),3);
        const futureLabels=await card.locator('.sleep-wave-peak-label').evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom}}));
        for(let i=0;i<futureLabels.length;i++)for(let j=i+1;j<futureLabels.length;j++)assert.ok(futureLabels[i].r<=futureLabels[j].l+1||futureLabels[j].r<=futureLabels[i].l+1||futureLabels[i].b<=futureLabels[j].t+1||futureLabels[j].b<=futureLabels[i].t+1,'multi-nap label overlap');
        await check('sleep-wave-three-future',true);
        await page.clock.setFixedTime(new Date('2026-11-16T11:08:00Z'));
        await visit('/','empty');await page.waitForSelector('.sleep-wave');assert.equal(await card.locator('[data-wave-forecast]').count(),0);
        await check('sleep-wave-learning',true);
        await visit('/','wave-fixture&night');await page.waitForSelector('[data-wave-compressed]');
        assert.equal(await card.locator('svg').count(),1);assert.equal(await card.locator('[data-wave-forecast]').count(),1);
        assert.ok((await card.locator('.sleep-wave-peak-label').allTextContents()).some(text=>text.includes('20:09')&&text.includes('06:53')),'condensed night keeps its timestamps');
        const nightBox=await card.locator('.sleep-wave-night-break').evaluate(e=>e.getBoundingClientRect().right),plotBox=await card.locator('svg').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,width:r.width}});
        assert.ok(nightBox-plotBox.left<plotBox.width*.2,'night stays condensed');
        const nightTicks=await card.locator('.sleep-wave-axis > span').evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}}));
        assert.ok(nightTicks.length>=3,'day axis keeps its hours');
        for(let i=1;i<nightTicks.length;i++)assert.ok(nightTicks[i].left>=nightTicks[i-1].right-1,'condensed axis labels overlap');
        const peaks=await card.locator('.sleep-wave-peak-label').evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom}}));
        for(let i=0;i<peaks.length;i++)for(let j=i+1;j<peaks.length;j++)assert.ok(peaks[i].r<=peaks[j].l+1||peaks[j].r<=peaks[i].l+1||peaks[i].b<=peaks[j].t+1||peaks[j].b<=peaks[i].t+1,'condensed labels overlap');
        await check('sleep-wave-night',true);console.log(context+' Sleep Wave checked');continue;
      }
      if(process.argv.includes('--next-sleep-only')){
        await visit('/','next-sleep-fixture');await page.waitForSelector('.sleep-wave-time');
        const card=page.locator('.sleep-wave');
        assert.ok((await card.textContent()).includes(lang==='en'?'Next Sleep':'Neste søvn'), await card.textContent());
        assert.equal(await card.evaluate(e=>e.previousElementSibling.classList.contains('home-live-state')),true);
        assert.equal(await card.locator('svg').count(),1);assert.equal(await card.locator('canvas,progress').count(),0);
        await check('next-sleep-ready',true);
        await visit('/','empty');await page.waitForSelector('.sleep-wave');
        assert.equal(await page.locator('.sleep-wave-time').count(),0);
        assert.ok((await page.locator('.sleep-wave').innerText()).includes(lang==='en'?'learning':'lærer'));
        await check('next-sleep-learning',true);
        await visit('/','active');await page.waitForSelector('.home-sleep-actions');
        await page.waitForFunction(()=>!document.querySelector('.home-sleep-actions > .sleep-action')?.disabled);
        assert.equal(await page.locator('.sleep-wave').count(),1);assert.equal(await page.locator('[data-wave-forecast]').count(),0);
        await check('next-sleep-sleeping',true);console.log(context+' Next Sleep checked');continue;
      }
      if(process.argv.includes('--recent-edit')){
        await visit('/','recent-edit');
        const rows=page.locator('.home-recent-sleep');
        await rows.first().waitFor();
        const count=await rows.count();
        for(const index of [0,Math.floor(count/2),count-1]){
          const row=rows.nth(index);
          await row.focus();
          await page.keyboard.press('Enter');
          const dialog=page.locator('[role=dialog]');
          await dialog.waitFor();
          const original=await row.innerText();
          await page.keyboard.press('Escape');
          assert.equal(await row.innerText(),original);
          await row.click();
          const inputs=dialog.locator('input[type=datetime-local]');
          const start=await inputs.first().inputValue();
          await inputs.last().fill(start.slice(0,11)+'23:59');
          await dialog.locator('.primary-button').click();
          await dialog.waitFor({state:'hidden'});
          assert.equal(await page.evaluate(()=>window.__editedSleeps.at(-1)),index===0?'sleep':'sleep-'+index);
          assert.match(await row.innerText(),/23:59/);
        }
        assert.equal(await page.evaluate(()=>window.__editedSleeps.length),3);
        await check('recent-sleep-edit',true);
        continue;
      }
      if(process.argv.includes('--home-refinement')){
        await visit('/','home-fixture&long');
        await page.locator('button.home-recent-row').first().click();
        assert.equal(await page.locator('input[type=datetime-local]').count(),2);
        await page.keyboard.press('Escape');
        await visit('/','home-fixture&active&long&home-refinement');
        await page.locator('.home-started').click();
        assert.equal(await page.locator('input[type=datetime-local]').count(),1);
        await page.locator('[role=dialog] .primary-button').click();
        await page.waitForFunction(()=>window.__corrected==='active' && window.__homeActive.endtime===null);
        await check('home-active-edit',true);
        await page.evaluate(()=>document.documentElement.style.fontSize='125%');
        await check('home-larger-text',true);
        await visit('/','empty');
        await check('home-empty',true);
        console.log(context+' refinement checked');
        continue;
      }
      if(process.argv.includes('--home-only')){
        const action=page.locator('.home-sleep-actions > .sleep-action'),change=page.locator('.home-change-time');
        const ready=async(extra='')=>{await visit('/','home-fixture&home-actions&'+extra);await page.waitForFunction(()=>{const e=document.querySelector('.home-sleep-actions > .sleep-action');return e&&!e.disabled;});};
        await ready();
        assert.equal(await page.locator('.sleep-wave, .today-stats').count(), 0);
        await check('home-awake',true);
        await change.click();await page.waitForSelector('[role="dialog"]');await check('home-start-sheet',true);
        await page.getByRole('button',{name:lang==='en'?'Choose time':'Velg tidspunkt',exact:true}).click();await check('home-start-explicit-time',true);
        await page.keyboard.press('Escape');assert.equal(await page.locator('[role="dialog"]').count(),0);
        assert.equal(await change.evaluate(e=>e===document.activeElement),true);
        await action.focus();await page.keyboard.down('Enter');await page.waitForTimeout(180);
        await page.keyboard.down('Enter');await page.keyboard.up('Enter');
        assert.deepEqual(await page.evaluate(()=>window.__sleepActions),[{kind:'start',minutes:0}]);
        assert.equal(await action.evaluate(e=>e===document.activeElement),true,'state transition should preserve keyboard action focus');
        await ready('active&sound=listening');
        assert.match(await page.locator('.home-current-value').innerText(), /42/);
        await page.locator('.home-started').click();
        await page.waitForSelector('progress');
        assert.equal(await page.locator('.home-wake-time').count(), 1);
        await page.keyboard.press('Escape');
        await check('home-sleeping-short',true);
        assert.equal(await page.locator('.home-sound-controls').count(), 0);
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
                  await page.locator('.bottom-nav a[href="/log"]').evaluate(e=>e.click());
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
          await ready('active&classification='+classification);
          await page.locator('.home-started').click();
          await page.waitForTimeout(60);
          assert.equal(await page.locator('progress,.home-wake-time').count(),0);
          const text=await page.getByRole('dialog').textContent();
          assert.equal(/Likely night sleep|Trolig natts\u00f8vn/.test(text),classification==='LONG_SLEEP_LIKE');
          await page.keyboard.press('Escape');
          await check('home-'+classification,true);
        }
        await ready('empty');assert.equal(await page.locator('button.home-recent-row').count(),0);await check('home-no-history');
        await ready('action-error');await change.click();await page.getByRole('dialog').getByRole('button',{name:lang==='en'?'Now':'Nå',exact:true}).click();
        await page.getByRole('dialog').getByRole('alert').waitFor();
        assert.ok(!/duplicate key|unique constraint/.test(await page.getByRole('dialog').textContent()));
        await check('home-failed-action',true);await page.keyboard.press('Escape');
        console.log(context+' Home checked');continue;
      }
      if (process.argv.includes('--settings-only')) {
        await visit('/settings');
        const nav = page.locator('.bottom-nav a[aria-current="page"]');
        const index = page.locator('.settings-index-list a');
        const sections = ['family','notifications','appearance','plus','account','about'];
        assert.deepEqual(await index.evaluateAll(links => links.map(link=>link.pathname)),
          sections.map(section=>'/settings/'+section));
        assert.equal(await page.locator('main input, main select, .plus-test-panel').count(),0);
        await check('settings-index',true);
        await index.first().click();
        await page.waitForURL('**/settings/family');
        await page.locator('.family-settings select').first().waitFor();
        await page.locator('.settings-member-roles').waitFor();
        await page.locator('#settings-baby').selectOption('baby-2');
        await page.waitForFunction(()=>document.querySelector('#settings-baby').value==='baby-2');
        await page.locator('.add-child-heading button').click();
        await check('settings-family');
        await page.locator('.family-settings > .primary-button').click();
        await page.waitForSelector('.invitation-code');
        await page.locator('.settings-detail-actions button').first().click();
        await page.locator('input[autocomplete=off]').last().waitFor();

        await visit('/settings/notifications','denied');
        await page.waitForSelector('.notification-settings__card');
        assert.match(await page.locator('main').innerText(),lang==='en'?/Notifications denied/:/Varsler.*avvist|iPhone-innstillinger/i);
        const likely = page.locator('.notification-settings label').filter({hasText:lang==='en'?/likely sleep/i:/forventet/i}).locator('input[type=checkbox]');
        await likely.click();
        assert.equal(await likely.isChecked(), false);
        await visit('/settings/notifications');
        await likely.check();
        assert.equal(await likely.isChecked(), true);
        await likely.uncheck();
        const activity = page.getByRole('switch');
        await activity.uncheck();
        await page.reload();
        await activity.waitFor();
        assert.equal(await activity.isChecked(),false);
        await activity.check();
        await check('settings-notifications',true);
        await page.locator('a[href="/settings/notifications/sound"]').click();
        await page.locator('.sound-settings select').waitFor();
        assert.equal(await nav.getAttribute('href'),'/settings');

        await visit('/settings/appearance');
        const preferences = page.locator('.settings-preference-list select');
        await preferences.first().selectOption(theme==='dark'?'light':'dark');
        assert.equal(await preferences.first().inputValue(), theme==='dark'?'light':'dark');
        await preferences.nth(1).selectOption(lang==='en'?'no':'en');
        assert.equal(await preferences.nth(1).inputValue(),lang==='en'?'no':'en');
        for (const skin of ['alive','outrun','default']) await preferences.last().selectOption(skin);
        await check('settings-appearance',true);

        await visit('/settings/plus');
        await page.getByRole('button',{name:/49 kr/}).waitFor();
        await page.locator('.settings-detail-actions button').first().click();
        await page.waitForFunction(()=>document.querySelector('main').textContent.match(/cancelled|avbrutt/i));
        await page.getByRole('button',{name:lang==='en'?/Restore purchases/i:/Gjenopprett/i}).click();
        assert.equal(await page.evaluate(()=>window.__restored),true);
        assert.doesNotMatch(await page.locator('main').innerText(),/RevenueCat|sandbox|test purchase|testkj.p/i);
        await visit('/settings/plus','missing-offering');
        await page.locator('main .text-button').waitFor();
        assert.equal(await page.getByRole('button',{name:/49 kr/}).count(),0);
        await visit('/settings/plus','plus-entitled');
        await page.locator('a[href="https://apps.apple.com/account/subscriptions"]').waitFor();
        await check('settings-plus',true);

        await visit('/settings/account');
        assert.match(await page.locator('.settings-account').innerText(),/parent.with.a.long.synthetic.email@example.invalid/);
        await page.locator('main button').click();
        assert.equal(await page.evaluate(()=>window.__signedOut),true);
        await visit('/settings/about');
        await page.waitForFunction(()=>document.querySelector('.settings-about')?.textContent.includes('14'));
        assert.equal(await page.locator('.settings-about-content a').count(),0);
        for (const section of [...sections,'notifications/sound']) {
          await visit('/settings/'+section);
          await page.reload();
          await page.locator('.settings-detail').waitFor();
          assert.equal(await nav.getAttribute('href'),'/settings');
        }
        console.log(context+' settings checked');continue;
      }
      if (process.argv.includes('--minimal-home')) {
        await visit('/', 'home-actions');
        await page.locator('.sleep-action').waitFor();
        await page.waitForFunction(() => !document.querySelector('.sleep-action').disabled);
        const home = page.locator('.home-minimal');
        assert.equal(await home.locator('.home-recent-row').count(), 3);
        assert.equal(await home.locator('.sleep-wave, .home-today, .family-message-card').count(), 0);
        assert.deepEqual(await home.locator('.home-quick-actions :is(.secondary-button,.sleep-action)').allTextContents(),
          lang === 'en' ? ['Diaper', 'Feed', 'Sleep'] : ['Bleie', 'Mating', 'S\u00f8vn']);
        if (width >= 375) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'awake Home fits the viewport');
        for (const row of [0, 1, 2]) {
          const edit = home.locator('button.home-recent-row').nth(row);
          await edit.click();
          await page.locator('[role="dialog"]').waitFor();
          await page.keyboard.press('Escape');
          await page.locator('[role="dialog"]').waitFor({ state: 'hidden' });
        }
        await home.locator('.sleep-action').click();
        await home.locator('.home-started').waitFor();
        await home.locator('.sleep-action').click();
        await home.locator('.home-started').waitFor({ state: 'hidden' });
        assert.deepEqual(await page.evaluate(() => window.__sleepActions), [
          { kind: 'start', minutes: 0 }, { kind: 'stop', minutes: 0 },
        ]);
        await home.locator('select').selectOption('baby-2');
        assert.equal(await home.locator('select').inputValue(), 'baby-2');
        await visit('/', 'active&sound=listening');
        await home.locator('.home-started').waitFor();
        assert.equal(await page.locator('.home-sound-controls').count(), 0);
        assert.equal(await home.locator('.home-quick-actions .secondary-button').count(), 0);
        assert.equal(await home.locator('.home-current-value').count(), 1);
        if (width >= 375) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'sleeping Home fits the viewport');
        await home.locator('.home-started').click();
        await page.locator('[role="dialog"]').waitFor();
        await page.keyboard.press('Escape');
        await visit('/', 'next-sleep-fixture');
        await home.locator('.home-current-value').waitFor();
        await visit('/', 'empty');
        await page.waitForFunction(() => !document.querySelector('.sleep-action').disabled);
        assert.equal(await home.locator('button.home-recent-row').count(), 0);
        assert.equal(await home.locator('.home-current-value').count(), 0);
        await check('minimal-home');
        await visit('/settings/notifications/sound', 'active&sound=listening');
        await page.locator('.sound-settings .home-sound-controls > summary').click();
        await page.locator('.sound-settings .sound-panel').waitFor();
        continue;
      }
      if (logOnly) {
        await visit('/history', 'log-fixture');
        assert.equal(new URL(page.url()).pathname, '/log');
        const log = page.locator('.log-page');
        const rows = log.locator('.log-row');
        const date = log.locator('input[type=date]');
        const row = id => log.locator('[data-event-id="'+id+'"]');
        const dialog = page.getByRole('dialog');
        await row('active').waitFor();
        assert.equal(await date.inputValue(), '2026-11-21');
        assert.equal(await row('overnight').count(), 1);
        const times = await rows.locator('time').evaluateAll(nodes => nodes.map(node => node.dateTime));
        assert.deepEqual(times, [...times].sort().reverse());
        await check('log-timeline', true);
        await log.locator('.log-date button').first().click();
        await page.waitForFunction(() => document.querySelector('.log-date input').value === '2026-11-20');
        await row('overnight').waitFor();
        assert.equal(await date.inputValue(), '2026-11-20');
        await log.locator('.log-date button').last().click();
        await row('active').waitFor();
        await row('active').click();
        assert.equal(await dialog.locator('input[type=datetime-local]').count(), 1);
        await dialog.locator('input[type=datetime-local]').fill('2026-11-21T17:55');
        await dialog.locator('.primary-button').click();
        await dialog.waitFor({state:'hidden'});
        assert.match(await row('active').innerText(), /17:55/);
        await row('sleep').focus();
        await page.keyboard.press('Enter');
        await dialog.getByRole('button', { name: lang === 'en' ? 'Split sleep' : /Del / }).click();
        await dialog.locator('.primary-button').click();
        await row('sleep-split').waitFor();
        await row('sleep-split').click();
        page.once('dialog', confirm => confirm.accept());
        await dialog.getByRole('button', { name: lang === 'en' ? /Delete sleep/ : /Slett/ }).click();
        await row('sleep-split').waitFor({ state: 'hidden' });
        await row('sleep').click();
        const sleepInputs = dialog.locator('input[type=datetime-local]');
        await sleepInputs.first().fill('2026-11-20T13:00');
        await sleepInputs.last().fill('2026-11-20T13:30');
        await dialog.locator('.primary-button').click();
        await row('sleep').waitFor({ state: 'hidden' });

        await row('feed-0').click();
        await dialog.locator('input[type=datetime-local]').waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await row('feed-0').evaluate(button => button === document.activeElement), true);
        await row('feed-0').click();
        await dialog.locator('input[type=datetime-local]').fill('2026-11-20T14:00');
        await dialog.locator('.primary-button').click();
        await row('feed-0').waitFor({ state: 'hidden' });
        await log.locator('.log-date button').first().click();
        await row('feed-0').waitFor();
        await row('sleep').waitFor();
        await row('feed-0').click();
        page.once('dialog', confirm => confirm.accept());
        await dialog.getByRole('button', { name: lang === 'en' ? /Delete feeding/ : /Slett/ }).click();
        await row('feed-0').waitFor({ state: 'hidden' });
        await page.evaluate(() => {
          window.__logFeeds.push({id:'remote', baby_id:'baby', starttime:'2026-11-20T17:00:00.000Z', feedtype:'food'});
          window.__feedRefresh();
        });
        await row('remote').waitFor();

        await date.fill('2026-10-24');
        await row('old').waitFor();
        await row('old').click();
        await dialog.locator('.diaper-types button').first().click();
        await dialog.locator('button[type=submit]').click();
        await dialog.waitFor({ state: 'hidden' });
        assert.match(await row('old').innerText(), lang === 'en' ? /Wet/ : /Tiss/i);
        await row('old').click();
        page.once('dialog', confirm => confirm.accept());
        await dialog.getByRole('button', { name: lang === 'en' ? /Delete diaper/ : /Slett/ }).click();
        await row('old').waitFor({ state: 'hidden' });

        for (const index of [0,1,2]) {
          await log.locator('.log-header button').click();
          await dialog.locator('button').nth(index).click();
          await dialog.locator('input[type=datetime-local]').first().waitFor();
          assert.ok((await dialog.locator('input[type=datetime-local]').first().inputValue()).startsWith('2026-10-24'));
          if (index === 2) await dialog.locator('.diaper-types button').last().click();
          await dialog.locator('.primary-button').click();
          await dialog.waitFor({ state: 'hidden' });
          await row(['new-sleep','new-feed','new'][index]).waitFor();
        }
        await date.fill('2026-11-21');
        await row('active').waitFor();
        await page.evaluate(() => window.__waveStore.setState({currentBabyId:'baby-2'}));
        await log.locator('.log-empty').waitFor();
        assert.equal(await rows.count(), 0);
        continue;
      }
      if(process.argv.includes('--navigation-only')){
        await visit('/');
        const nav = page.locator('.bottom-nav a');
        const labels = lang === 'en' ? ['Home', 'Log', 'Settings'] : ['Hjem', 'Logg', 'Innstillinger'];
        assert.deepEqual(await nav.evaluateAll(links => links.map(link => link.lastElementChild.textContent)), labels,
          'primary tabs have localized labels');
        assert.deepEqual(await nav.evaluateAll(links => links.map(link => link.getAttribute('href'))),
          ['/', '/log', '/settings']);
        assert.ok(await nav.evaluateAll(links => links.every(link => {
          const rect = link.getBoundingClientRect();
          return rect.width >= 44 && rect.height >= 44;
        })), 'primary targets are at least 44 by 44 pixels');
        for (const destination of ['/log', '/settings', '/']) {
          await page.locator('.bottom-nav a[href="'+destination+'"]').click();
          await page.waitForURL(url => url.pathname === destination);
        }
        await visit('/history', 'today=feed');
        assert.equal(new URL(page.url()).pathname, '/log');
        assert.equal(new URL(page.url()).searchParams.get('today'), 'feed');
        await page.reload();
        await page.waitForSelector('.history-page');
        await visit('/analysis');
        assert.equal(new URL(page.url()).pathname, '/');
        await visit('/unknown-route');
        assert.equal(new URL(page.url()).pathname, '/');
        await visit('/about');
        assert.equal(new URL(page.url()).pathname, '/settings/about');
        for (const section of ['family', 'notifications', 'appearance', 'plus', 'account', 'about', 'notifications/sound']) {
          await visit('/settings/'+section);
          await page.reload();
          await page.waitForSelector(section === 'about' ? '.about-page' : '.settings-page');
          assert.equal(await page.locator('.bottom-nav a[aria-current="page"]').getAttribute('href'), '/settings');
        }
        await check('navigation');
        continue;
      }
      if(process.argv.includes('--analysis-only')){
        await visit('/','view=analysis&probability-fixture');await page.waitForSelector('.sleep-probability-estimate');
        const probability=page.locator('.sleep-probability-card'),clock=probability.locator('input[type="time"]');
        await clock.fill('10:00');
        assert.match(await probability.locator('.sleep-probability-estimate').innerText(),/19/);
        await clock.fill('11:45');
        assert.match(await probability.locator('.sleep-probability-estimate').innerText(),/81/);
        await check('analysis-probability',true);
        await page.locator('.analysis-tab').nth(3).click();
        const insightRows = page.locator('[data-insight]');
        assert.ok((await insightRows.count()) > 0);
        assert.ok((await insightRows.evaluateAll(rows => rows.map(row => row.dataset.insight))).every(id =>
          ['typical-rhythm', 'median-wake-window', 'typical-naps', 'night-share', 'typical-longest-stretch', 'weekly-sleep-change'].includes(id)));
        await check('analysis-insights-populated',true);
        await visit('/','view=analysis&empty');await page.waitForSelector('.sleep-probability-card');
        assert.equal(await page.locator('.sleep-probability-estimate').count(),0);
        assert.match(await page.locator('.sleep-probability-card [role=status]').innerText(),lang==='en'?/Not enough sleep history/:/historikk/);
        await check('analysis-probability-empty',true);
        await visit('/','view=analysis');await page.waitForSelector('.analysis-tab-content');
        for(let i=0;i<6;i++){await page.locator('.analysis-tab').nth(i).click();await check('analysis-'+i,true);}
        const basis = page.locator('.data-basis');
        assert.equal(await basis.locator('.data-basis-days li').count(),30);
        const basisClock = basis.locator('input[type="time"]');
        await basisClock.fill('23:45');
        assert.equal(await basisClock.inputValue(),'23:45');
        await page.evaluate(()=>document.documentElement.style.fontSize='200%');
        await check('analysis-basis-large-text',true);
        await page.evaluate(()=>document.documentElement.style.fontSize='');
        console.log(context+' analysis checked');continue;
      }
      await visit();await check('home',true);
      await visit('/','active&sound=listening');await check('active-sleep-sound',true);
      await visit('/history');await page.waitForSelector('.log-row');await check('history',true);
      await page.locator('button.log-row').first().focus();await page.keyboard.press('Enter');await page.waitForSelector('[role="dialog"]');await check('history-keyboard-detail');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]')),true,'modal keyboard focus escaped');
      await page.keyboard.press('Escape');await page.waitForSelector('[role="dialog"]',{state:'detached'});
      assert.equal(await page.evaluate(()=>document.activeElement.matches('button.log-row')),true,'opening control did not regain focus');
      for(const view of ['feed','sleep','newSleep','split','message']){
        await visit('/',`view=${view}`);await check(view,true);
        if(view==='feed'){for(const i of [1,2]){await page.locator('.feed-type-button').nth(i).click();await check('feed-type-'+i);}}
        if(view==='sleep'){await page.waitForSelector('.sound-activity-event');await page.locator('.sound-activity-event').first().click();await check('sound-event-detail');await page.locator('.sound-activity-list summary').click();await check('sound-event-list');}
      }
      await visit('/','view=analysis');await page.waitForSelector('.analysis-tab-content');
      for(let i=0;i<6;i++){await page.locator('.analysis-tab').nth(i).click();await check('analysis-'+i,true);}
      await visit('/settings/family');await page.waitForSelector('.family-settings select');await check('settings-baby',true);
      await page.locator('.add-child-heading button').click();await check('add-child');
      await page.locator('.family-settings > .primary-button').click();await page.waitForSelector('.invitation-code');await check('invitation-code');
      for (const section of ['notifications','appearance','plus','account']) { await visit('/settings/'+section); await check('settings-'+section,true); }
      await visit('/about');await check('about',true);
      await visit('/','view=auth');await check('auth-apple',true);
      await page.locator('.auth-link-button').first().click();await check('auth-register');
      await page.locator('.auth-tab').first().click();await page.locator('.auth-link-button').last().click();await check('auth-forgot');
      await page.evaluate(()=>window.recovery());await check('auth-reset');
      await visit('/','view=auth&web');await check('auth-web');
      await visit('/','view=onboarding');await check('onboarding-create',true);await page.locator('.onboarding-tabs button').nth(1).click();await check('onboarding-join');
      for(const [name,route,extra] of [['home-empty','/','empty'],['history-empty','/history','empty'],['analysis-empty','/','view=analysis&empty'],
        ['sound-empty','/','view=sleep&empty'],['sound-error','/','view=sleep&error'],['settings-errors','/settings/family','error'],
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
