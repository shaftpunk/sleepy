/* Visual-fidelity capture: deterministic screenshots of real React screens with
   the synthetic fixtures and blocked network of tests/mobile-layout.cjs (reused
   verbatim from that file, not duplicated). No app/API writes, no assertions.
   node tests/visual-capture.cjs <playwright module path> [--out=<dir>] [--only=<name,...>]
     [--selector=<css>]    screenshot only that element (tall viewport, no fixed-nav overlap)
     [--reference=<png>]   also writes compare-*.png: reference | capture side by side
   Clock is pinned to 12:08 Europe/Oslo (the approved mockup's "Nå" time);
   --time=<ISO instant> overrides it (e.g. 2026-11-16T00:32:00Z for 01:32). */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const harness = fs.readFileSync(path.join(__dirname, 'mobile-layout.cjs'), 'utf8').split('\nasync function main()')[0];
const { chromium, fixture, mock, port, base, root } = new Function('require', '__dirname', 'process',
  `${harness}\nreturn { chromium, fixture, mock, port, base, root };`)(require, __dirname, process);

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const output = path.resolve(arg('out') || path.join(os.tmpdir(), 'sleepy-visual-capture'));
const only = arg('only')?.split(',');
const reference = arg('reference');
const selector = arg('selector');
fs.mkdirSync(output, { recursive: true });

// name, route, query, full page
const scenes = [];
for (const theme of ['light', 'dark']) {
  const q = `theme=${theme}&lang=no`;
  scenes.push(
    [`home-${theme}`, '/', `${q}&skin=default&wave-fixture`, false],
    [`home-${theme}-full`, '/', `${q}&skin=default&wave-fixture`, true],
    [`home-${theme}-night`, '/', `${q}&skin=default&wave-fixture&night`, false],
    [`home-${theme}-sleeping`, '/', `${q}&skin=default&wave-fixture&active`, false],
    [`home-${theme}-sleeping-full`, '/', `${q}&skin=default&wave-fixture&active`, true],
    [`home-${theme}-empty`, '/', `${q}&skin=default&empty`, false],
    [`home-${theme}-alive`, '/', `${q}&skin=alive&wave-fixture`, false],
    [`home-${theme}-outrun`, '/', `${q}&skin=outrun&wave-fixture`, false],
    [`history-${theme}`, '/history', `${q}&skin=default`, false],
    [`history-${theme}-plan`, '/history', `${q}&skin=default&wave-fixture&night`, true],
    [`history-${theme}-plan-active`, '/history', `${q}&skin=default&wave-fixture&active`, true],
    [`history-${theme}-plan-empty`, '/history', `${q}&skin=default&empty`, true],
    [`analysis-${theme}`, '/analysis', `${q}&skin=default&probability-fixture`, false],
    [`settings-${theme}`, '/settings', `${q}&skin=default`, false],
    [`onboarding-${theme}`, '/', `${q}&skin=default&view=onboarding`, false],
    [`auth-${theme}`, '/', `${q}&skin=default&view=auth`, false],
    [`sleep-modal-${theme}`, '/', `${q}&skin=default&view=sleep`, false],
    [`feed-modal-${theme}`, '/', `${q}&skin=default&view=feed`, false],
  );
}

async function main() {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], { cwd: root, stdio: 'ignore' });
  let browser;
  try {
    for (let n = 0; n < 150; n++) { try { if ((await fetch(base)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch({ headless: true, ...(process.env.SLEEPY_CHROMIUM_PATH ? { executablePath: process.env.SLEEPY_CHROMIUM_PATH } : {}) });
    const page = await browser.newPage({ timezoneId: 'Europe/Oslo', viewport: { width: Number(arg('width')) || 390, height: selector ? 2400 : 844 }, deviceScaleFactor: 2 });
    await page.clock.install({ time: new Date(arg('time') || '2026-11-16T11:08:00Z') });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== base) return route.abort();
      const body = u.pathname === '/src/main.tsx' ? fixture : mock(u.pathname);
      if (!body) return route.continue();
      const hash = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/.vite/deps/_metadata.json'), 'utf8')).browserHash;
      return route.fulfill({ contentType: 'application/javascript', body: body.replace(/(\/node_modules\/\.vite\/deps\/[^'"?]+\.js)(['"])/g, `$1?v=${hash}$2`) });
    });
    for (const [name, route, query, full] of scenes.filter(([name]) => !only || only.includes(name))) {
      await page.goto(`${base}${route}?${query}`);
      await page.waitForSelector('main, [role="dialog"], .feed-modal, .auth-page', { timeout: 15000 }).catch(() => {});
      await page.clock.runFor(1500);
      await page.waitForTimeout(500);
      const file = path.join(output, `${name}.png`);
      if (selector) await page.locator(selector).first().screenshot({ path: file });
      else await page.screenshot({ path: file, fullPage: full });
      if (reference && !full) {
        const img = f => `data:image/png;base64,${fs.readFileSync(f, 'base64')}`;
        const compare = await browser.newPage({ viewport: { width: 1180, height: 900 } });
        await compare.setContent(`<body style="margin:0;display:flex;gap:16px;padding:16px;background:#888;align-items:flex-start">
          <img src="${img(reference)}" style="height:868px"><img src="${img(file)}" style="height:868px"></body>`);
        await compare.screenshot({ path: path.join(output, `compare-${name}.png`), fullPage: true });
        await compare.close();
      }
      console.log('captured', name);
    }
    if (errors.length) console.log('page errors:', [...new Set(errors)]);
    console.log(`Screenshots: ${output}`);
  } finally { if (browser) await browser.close(); server.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
