import { mean, sigmoid, std } from "./vecmath.ts";

/** Deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const rnd = seededRandom(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Standardizer {
  means: number[];
  stds: number[];
}

export function fitStandardizer(X: number[][]): Standardizer {
  const d = X[0]?.length ?? 0;
  const means: number[] = [];
  const stds: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]);
    means.push(mean(col));
    stds.push(std(col) || 1); // constant features: avoid divide-by-zero
  }
  return { means, stds };
}

export function standardize(x: number[], s: Standardizer): number[] {
  return x.map((v, j) => (v - s.means[j]) / s.stds[j]);
}

export interface LogReg extends Standardizer {
  weights: number[];
  bias: number;
}

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  /** L2 penalty strength (not applied to the bias). */
  l2?: number;
}

/** Full-batch gradient descent logistic regression. Zero-initialised, so fully deterministic. y is 0 or 1. */
export function trainLogReg(X: number[][], y: number[], opts: TrainOptions = {}): LogReg {
  const { epochs = 3000, learningRate = 0.1, l2 = 0.01 } = opts;
  if (X.length === 0 || X.length !== y.length) throw new Error("trainLogReg needs equal, non-empty X and y.");
  const s = fitStandardizer(X);
  const Z = X.map((r) => standardize(r, s));
  const n = Z.length;
  const d = Z[0].length;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = sigmoid(z) - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= learningRate * (gw[j] / n + l2 * w[j]);
    b -= learningRate * (gb / n);
  }
  return { ...s, weights: w, bias: b };
}

export function predictProba(model: LogReg, x: number[]): number {
  const z = standardize(x, model);
  let s = model.bias;
  for (let j = 0; j < z.length; j++) s += model.weights[j] * z[j];
  return sigmoid(s);
}

export interface Metrics {
  accuracy: number;
  precision: number;
  recall: number;
  auc: number;
  n: number;
}

/** Area under the ROC curve via the rank-sum statistic, with tie handling. */
export function auc(scores: number[], labels: number[]): number {
  const idx = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
  let rankSumPos = 0;
  let pos = 0;
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (idx[k][1] === 1) { rankSumPos += avgRank; pos++; }
    i = j + 1;
  }
  const neg = idx.length - pos;
  return pos === 0 || neg === 0 ? NaN : (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function evaluate(model: LogReg, X: number[][], y: number[], threshold = 0.5): Metrics {
  const p = X.map((x) => predictProba(model, x));
  let tp = 0, fp = 0, fn = 0, correct = 0;
  p.forEach((pi, i) => {
    const pred = pi >= threshold ? 1 : 0;
    if (pred === y[i]) correct++;
    if (pred === 1 && y[i] === 1) tp++;
    if (pred === 1 && y[i] === 0) fp++;
    if (pred === 0 && y[i] === 1) fn++;
  });
  return {
    accuracy: correct / y.length,
    precision: tp + fp === 0 ? 0 : tp / (tp + fp),
    recall: tp + fn === 0 ? 0 : tp / (tp + fn),
    auc: auc(p, y),
    n: y.length,
  };
}
