/**
 * Состояние research/subagent jobs для Teams UI и interrupt.
 * Чистые helpers без vscode.
 */

export type ResearchJobStatus = 'queued' | 'running' | 'done' | 'error' | 'aborted';

export interface ResearchJob {
	id: string;
	status: ResearchJobStatus;
	subagent: string;
	promptPreview: string;
	prompt?: string;
	detail?: string;
	parentSessionId?: string;
	childSessionId?: string;
	worktreePath?: string;
	background?: boolean;
	mutating?: boolean;
	startedAt?: number;
	finishedAt?: number;
	reportSnippet?: string;
}

// Обновить или вставить job по id (сохраняем startedAt при переходе running->done)
export function upsertResearchJob(
	jobs: readonly ResearchJob[],
	patch: Partial<ResearchJob> & Pick<ResearchJob, 'id'>,
): ResearchJob[] {
	const idx = jobs.findIndex((j) => j.id === patch.id);
	const now = Date.now();
	if (idx < 0) {
		const created: ResearchJob = {
			id: patch.id,
			status: patch.status ?? 'queued',
			subagent: patch.subagent ?? 'explore',
			promptPreview: patch.promptPreview ?? '',
			prompt: patch.prompt,
			detail: patch.detail,
			parentSessionId: patch.parentSessionId,
			childSessionId: patch.childSessionId,
			worktreePath: patch.worktreePath,
			background: patch.background,
			mutating: patch.mutating,
			startedAt: patch.startedAt ?? (patch.status === 'running' ? now : undefined),
			finishedAt: patch.finishedAt,
			reportSnippet: patch.reportSnippet,
		};
		return [...jobs, created];
	}

	const prev = jobs[idx]!;
	const next: ResearchJob = {
		...prev,
		...patch,
		startedAt: prev.startedAt ?? patch.startedAt ?? (patch.status === 'running' ? now : prev.startedAt),
		finishedAt: patch.status === 'done' || patch.status === 'error' || patch.status === 'aborted'
			? (patch.finishedAt ?? now)
			: prev.finishedAt,
	};
	const copy = [...jobs];
	copy[idx] = next;
	return copy;
}

export function researchJobsBusySummary(jobs: readonly ResearchJob[]): string | undefined {
	const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
	if (running.length === 0) {
		return undefined;
	}

	if (running.length === 1) {
		const j = running[0]!;
		return `research ${j.subagent}: ${j.promptPreview.slice(0, 80)}...`;
	}

	return `research *${running.length} (${running.map((j) => j.subagent).join(', ')})`;
}

// Имена mutating tools для fan-out general (не research-only)
export function isMutatingParallelAllowed(subagentReadonly: boolean | undefined): boolean {
	return subagentReadonly === false;
}

export function countActiveResearchJobs(jobs: readonly ResearchJob[]): number {
	return jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
}
