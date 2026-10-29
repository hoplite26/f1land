import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('pageerror', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')));
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)));
await page.goto('http://localhost:5182/dev/scene.html?ch=ae-gp&q=medium&cam=follow');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(10000);
  const st = await page.evaluate(() => [window.__ready, !!window.__scene, !!window.__live?.getState().runner, !!window.__live?.getState().live, window.__live?.getState().loading, window.__live?.getState().progress, window.__live?.getState().error]);
  console.log(i, JSON.stringify(st));
  if (st[0]) break;
}
await browser.close();
