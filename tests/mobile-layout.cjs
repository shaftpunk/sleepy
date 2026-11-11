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
DOM.createRoot(document.getElementById('root')).render(view?React.createElement('div',{'data-theme':theme},views[view]):React.createElement(App));`;
const params = `const p=new URLSearchParams(location.search);`;
const records = `${params}const now=Date.now(),iso=n=>new Date(n).toISOString();const sleeps=p.has('empty')?[]:Array.from({length:35},(_,i)=>({id:i?'sleep-'+i:'sleep',baby_id:'baby',starttime:iso(now-(i*24+12)*3600000),endtime:iso(now-(i*24+2)*3600000),durationminutes:600,sleep_type:'sleep',rate:'5',deleted_at:null,note:p.has('long')?'Et langt notat som skal være lesbart på små skjermer. '+ 'x'.repeat(65):'A short note'}));const feeds=p.has('empty')?[]:Array.from({length:5},(_,i)=>({id:'feed-'+i,baby_id:'baby',feedtype:['bottle','breast','food'][i%3],amountml:120,side:'left',starttime:iso(now-i*7200000),note:'A synthetic feeding note'}));`;
const failure = `const blocked=async()=>{throw Error('duplicate key value violates unique constraint synthetic_settings_test')};`;
function mock(url) {
  if (url === '/src/auth/AuthProvider.tsx') return `${params}export const useAuth=()=>({user:{id:'user',email:'parent.with.a.long.synthetic.email@example.invalid',user_metadata:{full_name:'Alexandra Strande Engevik'}},session:{user:{id:'user'}},loading:p.has('loading'),signOut:async()=>{}});`;
  if (url === '/src/lib/supabase.ts') return `export const supabase={auth:{onAuthStateChange:f=>{window.recovery=()=>f('PASSWORD_RECOVERY');return {data:{subscription:{unsubscribe(){}}}}},getUser:async()=>({data:{user:{id:'user'}}})}};`;
  if (url === '/src/services/sleepService.ts') return records + failure + `export const getActiveSleep=async()=>p.has('active')?{...sleeps[0],endtime:null}:null,getLastCompletedSleep=async()=>sleeps[0]||null,getRecentSleeps=async()=>sleeps.slice(0,8),getAllSleeps=async()=>sleeps,getSleepsFromDate=async()=>sleeps,getSleepsOverlappingPeriod=async()=>sleeps;export {blocked as startSleep,blocked as stopSleep,blocked as resumeSleep,blocked as updateSleep,blocked as deleteSleep,blocked as splitSleep,blocked as createManualSleep};`;
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
  if (url.includes('@capacitor_core')) return `export const Capacitor={isNativePlatform:()=>true,getPlatform:()=>'ios',isPluginAvailable:()=>true};export const registerPlugin=()=>({setEnabled:async()=>{if(window.__sleepyBridgeFailure)throw Error('Synthetic native bridge failure')},reconcile:async()=>{},endAll:async()=>{},getAppInfo:async()=>({version:'1.0',build:'14'})});`;
}

async function main() {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], { cwd: root, stdio: 'ignore' });
  let browser;
  try {
    for (let n = 0; n < 100; n++) { try { if ((await fetch(base)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch({ headless: true, ...(process.env.SLEEPY_CHROMIUM_PATH ? { executablePath: process.env.SLEEPY_CHROMIUM_PATH } : {}) });
    const page = await browser.newPage();
    const errors = [], failures = [], screens = [];
    page.on('pageerror', e => errors.push(e.message));
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
    }
    for (const [width,height] of sizes) for (const theme of themes) for (const lang of ['no','en']) {
      const skin=(process.argv.find(value=>value.startsWith('--skin='))||'--skin=default').split('=')[1];
      context=`${width}x${height}-${theme}-${lang}-${skin}`;query=`theme=${theme}&lang=${lang}&skin=${skin}&long`;
      await page.setViewportSize({width,height});
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
