import * as vscode from 'vscode';
import { AGENT_LIMITS } from '../../policy';
import { relativeFromUri } from '../../workspacePath';

const SEVERITY: Record<number, string> = {
	[vscode.DiagnosticSeverity.Error]: 'error',
	[vscode.DiagnosticSeverity.Warning]: 'warning',
	[vscode.DiagnosticSeverity.Information]: 'info',
	[vscode.DiagnosticSeverity.Hint]: 'hint',
};

export type DiagnosticItem = {
	path: string;
	line: number;
	character: number;
	severity: string;
	source: string | null;
	message: string;
};

export type DiagnosticsSnapshot = {
	truncated: boolean;
	count: number;
	total: number;
	errorCount: number;
	diagnostics: DiagnosticItem[];
};

const EMBED_MAX = 40;
const MESSAGE_MAX = 240;

export type CollectDiagnosticsOpts = {
	max?: number;
	severities?: vscode.DiagnosticSeverity[];
	maxMessageLen?: number;
};

export async function collectDiagnosticsForUris(
	uris: readonly vscode.Uri[],
	opts?: CollectDiagnosticsOpts,
): Promise<DiagnosticsSnapshot> {
	const cap = Math.min(
		Math.max(1, opts?.max ?? EMBED_MAX),
		AGENT_LIMITS.maxDiagnostics,
	);
	const allowed = new Set(
		opts?.severities ?? [vscode.DiagnosticSeverity.Error],
	);
	const maxMsg = opts?.maxMessageLen ?? MESSAGE_MAX;
	const items: DiagnosticItem[] = [];
	let total = 0;
	let errorCount = 0;

	for (const uri of uris) {
		const diags = vscode.languages.getDiagnostics(uri);
		const file = await relativeFromUri(uri);
		for (const diag of diags) {
			if (!allowed.has(diag.severity)) {
				continue;
			}

			total += 1;
			if (diag.severity === vscode.DiagnosticSeverity.Error) {
				errorCount += 1;
			}

			if (items.length >= cap) {
				continue;
			}

			const msg = diag.message.length > maxMsg
				? `${diag.message.slice(0, maxMsg)}...`
				: diag.message;
			items.push({
				path: file,
				line: diag.range.start.line + 1,
				character: diag.range.start.character + 1,
				severity: SEVERITY[diag.severity] ?? String(diag.severity),
				source: diag.source ?? null,
				message: msg,
			});
		}
	}

	return {
		truncated: total > items.length,
		count: items.length,
		total,
		errorCount,
		diagnostics: items,
	};
}

export async function waitForDiagnosticsSettle(
	uris: readonly vscode.Uri[],
	timeoutMs = 1_200,
): Promise<void> {
	if (uris.length === 0 || timeoutMs <= 0) {
		return;
	}

	const targets = new Set(uris.map((u) => u.toString()));
	await new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) {
				return;
			}

			done = true;
			sub.dispose();
			clearTimeout(timer);
			resolve();
		};
		const sub = vscode.languages.onDidChangeDiagnostics((e) => {
			if (e.uris.some((u) => targets.has(u.toString()))) {
				finish();
			}
		});
		const timer = setTimeout(finish, timeoutMs);
	});
}

export function formatDiagnosticsVerifyBlock(snap: DiagnosticsSnapshot): string {
	if (snap.total === 0) {
		return '### Verify (diagnostics)\n(no errors)';
	}
	
	return `### Verify (diagnostics)\n\`\`\`json\n${JSON.stringify(snap, null, 2)}\n\`\`\``;
}
