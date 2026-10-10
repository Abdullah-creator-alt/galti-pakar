/** Pure vector and statistics helpers. No dependencies. */

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function norm(a: ArrayLike<number>): number {
  return Math.sqrt(dot(a, a));
}

/** L2-normalise. A zero vector is returned unchanged. */
export function normalize(a: ArrayLike<number>): number[] {
  const n = norm(a);
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = n === 0 ? 0 : a[i] / n;
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const na = norm(a);
  const nb = norm(b);
  return na === 0 || nb === 0 ? 0 : dot(a, b) / (na * nb);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Population standard deviation. */
export function std(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Mid-rank percentile of `value` within `population`, 0-100. Ties count half. */
export function percentileRank(value: number, population: number[]): number {
  if (population.length === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const x of population) {
    if (x < value) below++;
    else if (x === value) equal++;
  }
  return (100 * (below + equal / 2)) / population.length;
}

export function topK(xs: number[], k: number): number[] {
  return [...xs].sort((a, b) => b - a).slice(0, k);
}

export function round(x: number, places: number): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

export function roundVec(v: number[], places = 5): number[] {
  return v.map((x) => round(x, places));
}

export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}
