// Scene screenshot sequence in ONE browser session (SwiftShader is slow; startup is the expensive part).
// Usage:
//   node dev/shot-scene.mjs --dir /tmp/verify/c --quality high --channel ae-gp \
//     --shots "director:8000,follow:4000,tv:4000,heli:4000,onboard:4000,overview:4000" [--prefix ae-] [--full]
//   Each shot: <camera>:<waitMs>[:<js to eval before waiting>]. Prints renderer.info per shot.
import { chromium } from '@playwright/test';
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? (a[i + 1]?.startsWith('--') || a[i + 1] === undefined ? true : a[i + 1]) : d; };
const dir = arg('dir', '/tmp/verify/c');
const prefix = arg('prefix', '');
const quality = arg('quality', 'high');
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +arg('w', 390), height: +arg('h', 844) }, deviceScaleFactor: +arg('dpr', 1.5), isMobile: true, hasTouch: true });
page.setDefaultTimeout(240000);
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[scene]')) errs.push('console: ' + m.text()); });
const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i > 4) throw e; await page.waitForTimeout(3000); } } };
console.log("goto"); await page.goto(arg('url', 'http://localhost:5173/'));
await page.waitForLoadState('networkidle').catch(() => {});
await retry(() => page.evaluate(({ quality }) => {
  localStorage.setItem('pa-f1-settings', JSON.stringify({ state: { lang: 'ru', quality, motion: 'full', haptics: true, sound: false, renderMode: '3d', camera: 'director', showZones: true, favoriteDriver: null, onboarded: true }, version: 1 }));
}, { quality }));
await page.reload();
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1500);
await retry(() => page.evaluate(() => window.__nav.getState().go('live')));
const ch = arg('channel');
if (ch) { await page.waitForTimeout(800); await page.evaluate((id) => window.__live.getState().open(id), ch); }
const pre = arg('eval');
if (pre) { await page.waitForTimeout(1500); await page.evaluate(pre); }
console.log("ready"); const shots = String(arg('shots', 'director:8000')).split(',');
for (const spec of shots) {
  const [cam, wait, ...js] = spec.split(':');
  await page.evaluate((c) => window.__settings.getState().set({ camera: c }), cam);
  if (js.length) await page.evaluate(js.join(':'));
  await page.waitForTimeout(+(wait ?? 4000));
  console.log('shooting', cam); const out = `${dir}/${prefix}${cam}.png`;
  const host = arg('full') ? null : await page.$('.scene-host');
  if (host) await host.screenshot({ path: out, timeout: 240000 });
  else await page.screenshot({ path: out, timeout: 240000 });
  const info = await page.evaluate(() => {
    const s = window.__scene;
    if (!s) return null;
    const r = s.renderer.info;
    return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures, progs: r.programs?.length, ...(s.stats?.() ?? {}) };
  });
  console.log('saved', out, JSON.stringify(info));
}
if (errs.length) console.log(errs.slice(0, 15).join('\n'));
await browser.close();
