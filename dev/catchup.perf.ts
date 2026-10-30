import { test } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { SessionRunner } from '@/demo/runner';

const log = (s: string) => appendFileSync('/tmp/lv3d/bench.txt', s + '\n');

test('catch-up cost', async () => {
  const r = new SessionRunner('mx-gp', 'live');
  await r.init(Date.now());
  const s = new Session();
  s.connect();
  await s.post('Profiler.enable');
  await s.post('Profiler.start');
  for (let i = 0; i < 40; i++) {
    const t1 = performance.now();
    const goal = r.sim.t + 60;
    while (r.sim.t + 0.05 <= goal) r.sim.advanceTo(Math.min(goal, r.sim.t + 20));
    const sim = r.sim as unknown as { status: string; lap?: number; trackState?: string };
    log(`t=${r.sim.t.toFixed(0)} ${(performance.now() - t1).toFixed(0)}ms ${sim.status} ${JSON.stringify(r.live().trackState)} lap ${r.live().lap}`);
  }
  const { profile } = await s.post('Profiler.stop');
  writeFileSync('/tmp/lv3d/sim.cpuprofile', JSON.stringify(profile));
}, 120000);
