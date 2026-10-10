export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolated quantile, p in [0, 1]. */
export function quantile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function distribution(xs: number[]) {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return xs.length
    ? { n: xs.length, median: r(quantile(xs, 0.5)), q1: r(quantile(xs, 0.25)), q3: r(quantile(xs, 0.75)), min: r(Math.min(...xs)), max: r(Math.max(...xs)) }
    : { n: 0, median: 0, q1: 0, q3: 0, min: 0, max: 0 };
}
