// Screenshots of the standalone scene harness (dev/scene.html on :5182) — independent of app screens.
//   node dev/shot-harness.mjs --dir /tmp/verify/c --prefix ae-high- --q high --ch ae-gp \
//     --shots "director:6000,follow:3000,tv:3000" [--params "zone=2&follow=VER"] [--w 390 --h 844 --dpr 1]
// Each shot: <camera>:<waitMs>[:<js>]. Prints renderer stats per shot.
import { chromium } from '@playwright/test';
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? (a[i + 1]?.startsWith('--') || a[i + 1] === undefined ? true : a[i + 1]) : d; };
const dir = arg('dir', '/tmp/verify/c');
const prefix = arg('prefix', '');
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +arg('w', 390), height: +arg('h', 844) }, deviceScaleFactor: +arg('dpr', 1), isMobile: true, hasTouch: true });
page.setDefaultTimeout(300000);
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('crash', () => console.log('PAGE CRASHED'));
browser.on('disconnected', () => console.log('BROWSER DISCONNECTED'));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
const url = `http://localhost:5182/dev/scene.html?ch=${arg('ch', 'ae-gp')}&q=${arg('q', 'medium')}&cam=${String(arg('shots', 'director:1')).split(':')[0]}&${arg('params', '')}`;
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
// Wait for the live feed (sim catch-up) so cars are on track.
await page.waitForFunction(() => !!window.__live.getState().live && !window.__live.getState().runner?.catchingUp, null, { timeout: 300000 });
console.log('live in', ((Date.now() - t0) / 1000).toFixed(1), 's');
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
for (const spec of String(arg('shots', 'director:6000')).split(',')) {
  const [cam, wait, ...js] = spec.split(':');
  await page.evaluate((c) => window.__setCam(c), cam);
  if (js.length) await page.evaluate(js.join(':'));
  await page.waitForTimeout(+(wait ?? 3000));
  // SwiftShader is slow: wait for the camera to settle, then a few more frames.
  await page.waitForFunction(() => window.__scene?.rig.settled, null, { timeout: 240000 });
  const f0 = await page.evaluate(() => window.__scene.frameCount);
  await page.waitForFunction((f) => window.__scene.frameCount > f + 4, f0, { timeout: 240000 });
  const out = `${dir}/${prefix}${cam}.png`;
  await page.screenshot({ path: out, timeout: 300000 });
  const st = await page.evaluate(() => window.__scene?.stats());
  console.log('saved', out, JSON.stringify(st));
}
if (errs.length) console.log([...new Set(errs)].slice(0, 15).join('\n'));
await browser.close();
