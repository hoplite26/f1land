// CPU profile of the Live screen during feed catch-up (bottom-up self time).
// node dev/profile-sync.mjs [--render 2d|3d] [--ms 12000]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.addInitScript(({ renderMode }) => {
  localStorage.setItem('pa-f1-settings', JSON.stringify({ state: { lang: 'ru', quality: 'medium', motion: 'full', haptics: true, sound: false, renderMode, camera: 'director', showZones: true, favoriteDriver: null, onboarded: true }, version: 1 }));
}, { renderMode: arg('render', '2d') });
await page.goto(arg('url', 'http://localhost:5193/'));
await page.waitForFunction(() => !!window.__nav, null, { timeout: 120000, polling: 250 });
await page.evaluate(() => window.__nav.getState().go('live'));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.waitForTimeout(+arg('ms', 12000));
const { profile } = await cdp.send('Profiler.stop');
writeFileSync('/tmp/lv3d/page.cpuprofile', JSON.stringify(profile));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/').split('?')[0]}:${n.callFrame.lineNumber}`;
  self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0));
});
const total = [...self.values()].reduce((x, y) => x + y, 0);
console.log('total ms', (total / 1000).toFixed(0));
[...self].sort((x, y) => y[1] - x[1]).slice(0, +arg('top', 25)).forEach(([k, t]) => console.log((t / 1000).toFixed(0).padStart(7), 'ms', k));
console.log('simT', await page.evaluate(() => Math.round(window.__live.getState().runner?.sim?.t ?? 0)));
await browser.close();
