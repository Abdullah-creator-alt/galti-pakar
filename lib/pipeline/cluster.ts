import type { BenchmarkPoint, PointType, QualityBasis } from "./benchmark.types.ts";
import { cosine, dot, normalize, roundVec } from "./vecmath.ts";

export interface RawPoint {
  point: string;
  type: PointType;
  vec: number[];
  essayId: string;
  qualityBasis: QualityBasis;
}

interface Cluster {
  members: RawPoint[];
  centroid: number[];
  essays: Set<string>;
}

function makeCluster(members: RawPoint[]): Cluster {
  const sum = new Array<number>(members[0].vec.length).fill(0);
  for (const m of members) for (let i = 0; i < sum.length; i++) sum[i] += m.vec[i];
  return { members, centroid: normalize(sum), essays: new Set(members.map((m) => m.essayId)) };
}

/**
 * Agglomerative clustering (centroid linkage). Repeatedly merges the two most similar clusters while their
 * cosine is at least `threshold`. Two clusters that contain points from the same essay are never merged,
 * because one essay's distinct points are distinct by construction. Deterministic.
 */
export function clusterPoints(points: RawPoint[], threshold: number): Cluster[] {
  let clusters = points.map((p) => makeCluster([p]));
  for (;;) {
    let best = -1;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const s = dot(clusters[i].centroid, clusters[j].centroid);
        if (s > best && s >= threshold && ![...clusters[i].essays].some((e) => clusters[j].essays.has(e))) {
          best = s;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) return clusters;
    const merged = makeCluster([...clusters[bi].members, ...clusters[bj].members]);
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(merged);
  }
}

function mostCommon<T>(xs: T[], fallback: T): T {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let best = fallback;
  let n = 0;
  for (const [k, v] of c) if (v > n) { best = k; n = v; }
  return best;
}

/** Merges one theme's reference points into benchmark points. ofN is the number of essays in the theme. */
export function mergeThemePoints(points: RawPoint[], ofN: number, threshold: number): BenchmarkPoint[] {
  return clusterPoints(points, threshold)
    .map((c) => {
      // Representative paraphrase: the member closest to the centroid.
      const rep = c.members.reduce((a, b) => (cosine(b.vec, c.centroid) > cosine(a.vec, c.centroid) ? b : a));
      return {
        point: rep.point,
        type: mostCommon(c.members.map((m) => m.type), rep.type),
        origin: "reference" as const,
        madeByCount: c.essays.size,
        ofN,
        sourceQualityBases: [...new Set(c.members.map((m) => m.qualityBasis))].sort(),
        centroid: roundVec(c.centroid),
      };
    })
    .sort((a, b) => (b.madeByCount ?? 0) - (a.madeByCount ?? 0) || a.point.localeCompare(b.point));
}
