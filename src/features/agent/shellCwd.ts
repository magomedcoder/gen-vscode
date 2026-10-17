import * as path from 'node:path';

export type ShellCwdResolver = (candidate: string) => Promise<{ fsPath: string }>;

export function shellCwdCandidate(currentCwd: string, relativeOrAbs?: string): string {
	const raw = (relativeOrAbs ?? '').trim();
	if (!raw || raw === '.') {
		return path.resolve(currentCwd);
	}

	return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(currentCwd, raw);
}

export async function resolveShellCwd(
	currentCwd: string,
	relativeOrAbs: string | undefined,
	resolveAllowedPath: ShellCwdResolver,
): Promise<string> {
	const candidate = shellCwdCandidate(currentCwd, relativeOrAbs);
	try {
		return (await resolveAllowedPath(candidate)).fsPath;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Shell cwd denied: ${message}`);
	}
}
