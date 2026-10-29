import type { CircuitData, CircuitMeta } from './types';
import metaJson from './generated/meta.json';

export * from './types';
export * from './geometry';

/** All 2026 circuits (calendar order), without geometry — safe to bundle eagerly. */
export const CIRCUIT_META: CircuitMeta[] = metaJson as CircuitMeta[];

const META_BY_ID = new Map(CIRCUIT_META.map((m) => [m.id, m]));

export function getCircuitMeta(id: string): CircuitMeta {
  const meta = META_BY_ID.get(id);
  if (!meta) throw new Error(`Unknown circuit id: ${id}`);
  return meta;
}

// One lazy chunk per circuit (~20–40 kB each); meta.json stays in the main bundle.
const loaders = import.meta.glob<{ default: CircuitData }>(['./generated/*.json', '!./generated/meta.json']);

const pending = new Map<string, Promise<CircuitData>>();
const loaded = new Map<string, CircuitData>();

export function loadCircuit(id: string): Promise<CircuitData> {
  const cached = pending.get(id);
  if (cached) return cached;
  const loader = loaders[`./generated/${id}.json`];
  if (!loader) return Promise.reject(new Error(`Unknown circuit id: ${id}`));
  const promise = loader().then(
    (mod) => {
      const data = mod.default;
      loaded.set(id, data);
      return data;
    },
    (err: unknown) => {
      pending.delete(id); // allow a retry after a failed chunk fetch
      throw err;
    },
  );
  pending.set(id, promise);
  return promise;
}

/** Synchronous access to a circuit that has already been loaded (e.g. inside a render loop). */
export function getCachedCircuit(id: string): CircuitData | undefined {
  return loaded.get(id);
}
