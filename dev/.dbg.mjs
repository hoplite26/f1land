import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto('http://localhost:5182/dev/scene.html?ch=ae-gp&q=low&cam=overview');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(4000);
  console.log(await page.evaluate(() => { const r = window.__scene.rig; const f = (v) => [v.x, v.y, v.z].map((n) => Math.round(n)).join(','); return `cam ${f(r.camera.position)} tgt ${f(r.controls.target)} off ${f(r.overviewOffset)} aspect ${r.camera.aspect.toFixed(2)} fov ${r.camera.fov} b ${r.boundsW},${r.boundsH} fly ${!!r.fly} mode ${r.mode}`; }));
}
const live = await page.evaluate(() => { const st = window.__live.getState(); return st.live && st.live.cars.slice(0, 3).map((c) => `${c.id} ${c.mode} ${c.status}`).join(' | ') + ' ' + st.live.status + ' ' + st.live.trackState; });
console.log(live);
await browser.close();
