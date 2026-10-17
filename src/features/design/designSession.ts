import type { Memento } from 'vscode';

const STORAGE_KEY = 'gen.design.lastSelection';

export interface DesignSelection {
	url: string;
	selector: string;
	sourcePath?: string;
	line?: number;
	inspectedAt: number;
}

let store: Memento | undefined;
let lastSelection: DesignSelection | undefined;

export function initDesignSession(workspaceState: Memento): void {
	store = workspaceState;
	lastSelection = workspaceState.get<DesignSelection>(STORAGE_KEY);
}

export function getLastDesignSelection(): DesignSelection | undefined {
	return lastSelection ? { ...lastSelection } : undefined;
}

export async function setLastDesignSelection(selection: DesignSelection): Promise<void> {
	lastSelection = { ...selection };
	await store?.update(STORAGE_KEY, lastSelection);
}
