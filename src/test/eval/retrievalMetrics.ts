export function normalizeRetrievalPath(path: string): string {
	return path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function toRelevantSet(relevant: Iterable<string>): Set<string> {
	const set = new Set<string>();
	for (const item of relevant) {
		const n = normalizeRetrievalPath(item);
		if (n) {
			set.add(n);
		}
	}

	return set;
}

function isRelevantPath(path: string, relevant: Set<string>): boolean {
	const n = normalizeRetrievalPath(path);
	if (relevant.has(n)) {
		return true;
	}

	for (const r of relevant) {
		if (n === r || n.endsWith(`/${r}`) || r.endsWith(`/${n}`)) {
			return true;
		}
	}

	return false;
}

export function precisionAtK(
	rankedPaths: readonly string[],
	relevant: Iterable<string>,
	k: number,
): number {
	if (k <= 0) {
		return 0;
	}

	const rel = toRelevantSet(relevant);
	const top = rankedPaths.slice(0, k).map(normalizeRetrievalPath).filter(Boolean);
	if (top.length === 0) {
		return 0;
	}

	let hits = 0;
	for (const p of top) {
		if (isRelevantPath(p, rel)) {
			hits += 1;
		}
	}

	return hits / Math.min(k, top.length);
}

export function hitAtK(
	rankedPaths: readonly string[],
	relevant: Iterable<string>,
	k: number,
): boolean {
	if (k <= 0) {
		return false;
	}
	const rel = toRelevantSet(relevant);
	const top = rankedPaths.slice(0, k);
	return top.some((p) => isRelevantPath(p, rel));
}

export function reciprocalRank(
	rankedPaths: readonly string[],
	relevant: Iterable<string>,
): number {
	const rel = toRelevantSet(relevant);
	for (let i = 0; i < rankedPaths.length; i += 1) {
		if (isRelevantPath(rankedPaths[i]!, rel)) {
			return 1 / (i + 1);
		}
	}
	return 0;
}

export interface RetrievalCaseInput {
	query: string;
	rankedPaths: readonly string[];
	relevant: readonly string[];
}

export interface RetrievalCaseMetrics {
	query: string;
	k: number;
	precisionAtK: number;
	hit: boolean;
	reciprocalRank: number;
	simpleScore: number;
}

export interface RetrievalSuiteMetrics {
	k: number;
	cases: RetrievalCaseMetrics[];
	hitRate: number;
	meanPrecisionAtK: number;
	meanReciprocalRank: number;
	simpleScore: number;
}

export interface RetrievalGateThresholds {
	k: number;
	minHitRate: number;
	minMeanPrecisionAtK: number;
	minSimpleScore: number;
}

export const DEFAULT_RETRIEVAL_GATE: RetrievalGateThresholds = {
	k: 3,
	minHitRate: 1,
	minMeanPrecisionAtK: 0.4,
	minSimpleScore: 0.7,
};

export function scoreRetrievalCase(input: RetrievalCaseInput, k: number): RetrievalCaseMetrics {
	const precision = precisionAtK(input.rankedPaths, input.relevant, k);
	const hit = hitAtK(input.rankedPaths, input.relevant, k);
	const rr = reciprocalRank(input.rankedPaths, input.relevant);
	const simpleScore = (Number(hit) + precision + rr) / 3;
	return {
		query: input.query,
		k,
		precisionAtK: precision,
		hit,
		reciprocalRank: rr,
		simpleScore,
	};
}

export function aggregateRetrievalMetrics(
	cases: readonly RetrievalCaseInput[],
	k: number = DEFAULT_RETRIEVAL_GATE.k,
): RetrievalSuiteMetrics {
	const scored = cases.map((c) => scoreRetrievalCase(c, k));
	const n = scored.length;
	if (n === 0) {
		return {
			k,
			cases: [],
			hitRate: 0,
			meanPrecisionAtK: 0,
			meanReciprocalRank: 0,
			simpleScore: 0,
		};
	}

	const hitRate = scored.filter((c) => c.hit).length / n;
	const meanPrecisionAtK = scored.reduce((s, c) => s + c.precisionAtK, 0) / n;
	const meanReciprocalRank = scored.reduce((s, c) => s + c.reciprocalRank, 0) / n;
	const simpleScore = scored.reduce((s, c) => s + c.simpleScore, 0) / n;

	return {
		k,
		cases: scored,
		hitRate,
		meanPrecisionAtK,
		meanReciprocalRank,
		simpleScore,
	};
}

export interface RetrievalGateResult {
	ok: boolean;
	failures: string[];
	metrics: RetrievalSuiteMetrics;
	thresholds: RetrievalGateThresholds;
}

export function checkRetrievalGate(
	metrics: RetrievalSuiteMetrics,
	thresholds: RetrievalGateThresholds = DEFAULT_RETRIEVAL_GATE,
): RetrievalGateResult {
	const failures: string[] = [];
	if (metrics.hitRate + 1e-9 < thresholds.minHitRate) {
		failures.push(
			`hitRate@${metrics.k}=${metrics.hitRate.toFixed(3)} < min ${thresholds.minHitRate}`,
		);
	}

	if (metrics.meanPrecisionAtK + 1e-9 < thresholds.minMeanPrecisionAtK) {
		failures.push(
			`meanPrecision@${metrics.k}=${metrics.meanPrecisionAtK.toFixed(3)} < min ${thresholds.minMeanPrecisionAtK}`,
		);
	}

	if (metrics.simpleScore + 1e-9 < thresholds.minSimpleScore) {
		failures.push(
			`simpleScore=${metrics.simpleScore.toFixed(3)} < min ${thresholds.minSimpleScore}`,
		);
	}

	return {
		ok: failures.length === 0,
		failures,
		metrics,
		thresholds,
	};
}

export function assertRetrievalGate(
	metrics: RetrievalSuiteMetrics,
	thresholds: RetrievalGateThresholds = DEFAULT_RETRIEVAL_GATE,
): void {
	const result = checkRetrievalGate(metrics, thresholds);
	if (!result.ok) {
		const detail = result.failures.join('; ');
		throw new Error(`порог eval retrieval не пройден: ${detail}`);
	}
}
