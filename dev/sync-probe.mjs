// Startup timing probe: time until the 3D scene is built and the live feed is synced (no screenshots).
// node dev/sync-probe.mjs [--url http://localhost:5193/] [--quality medium] [--render 3d|2d] [--shot out.png]
import { chromium } from '@playwright/test';
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +arg('w', 390), height: +arg('h', 844) }, deviceScaleFactor: +arg('dpr', 1), isMobile: true, hasTouch: true });
const url = arg('url', 'http://localhost:5193/');
await page.addInitScript(({ quality, renderMode }) => {
  localStorage.setItem('pa-f1-settings', JSON.stringify({ state: { lang: 'ru', quality, motion: 'full', haptics: true, sound: false, renderMode, camera: 'director', showZones: true, favoriteDriver: null, onboarded: true }, version: 1 }));
}, { quality: arg('quality', 'medium'), renderMode: arg('render', '3d') });
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => !!window.__nav, null, { timeout: 120000, polling: 250 });
console.log('app ready', (Date.now() - t0) / 1000);
await page.evaluate(() => window.__nav.getState().go('live'));
// Progress log every 5 s until synced (and scene built in 3D).
const tl = Date.now();
for (;;) {
  const st = await page.evaluate(() => {
    const l = window.__live.getState();
    const s = window.__scene;
    return { synced: !!(l.live && !l.loading), progress: +(l.progress ?? 0).toFixed(3), frames: s?.frameCount ?? null, built: !!(s && s.trace && s.sc), simT: Math.round(l.runner?.sim?.t ?? 0) };
  });
  console.log(`+${((Date.now() - tl) / 1000).toFixed(1)}s`, JSON.stringify(st));
  if (st.synced && (st.built || arg('render', '3d') === '2d')) break;
  await page.waitForTimeout(5000);
}
console.log('done after', (Date.now() - tl) / 1000, 's since Live opened');
const shot = arg('shot');
if (shot) { await page.waitForTimeout(+arg('wait', 4000)); await page.screenshot({ path: shot }); console.log('saved', shot); }
await browser.close();
