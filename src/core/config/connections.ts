import type { GenSettings } from './types';

// Шкала контекста workspace (UI): off | manual | auto | full
export type WorkspaceContextScale = 'off' | 'manual' | 'auto' | 'full';

export function readWorkspaceContextScale(settings: Pick<GenSettings, 'enableWorkspaceContext' | 'shareMode' | 'alwaysOnWorkspaceContext'>): WorkspaceContextScale {
	if (!settings.enableWorkspaceContext) {
		return 'off';
	}

	if (settings.alwaysOnWorkspaceContext && settings.shareMode === 'auto') {
		return 'full';
	}

	if (settings.shareMode === 'auto') {
		return 'auto';
	}

	return 'manual';
}

export function applyWorkspaceContextScale(
	settings: GenSettings,
	scale: WorkspaceContextScale,
): Pick<GenSettings, 'enableWorkspaceContext' | 'shareMode' | 'alwaysOnWorkspaceContext'> {
	switch (scale) {
		case 'off':
			return { enableWorkspaceContext: false, shareMode: 'disabled', alwaysOnWorkspaceContext: false };
		case 'auto':
			return { enableWorkspaceContext: true, shareMode: 'auto', alwaysOnWorkspaceContext: false };
		case 'full':
			return { enableWorkspaceContext: true, shareMode: 'auto', alwaysOnWorkspaceContext: true };
		case 'manual':
		default:
			return { enableWorkspaceContext: true, shareMode: 'manual', alwaysOnWorkspaceContext: false };
	}
}

// Один контроль «открывать файл после правки»
export type OpenAfterEditMode = 'never' | 'preview' | 'focus';

export function readOpenAfterEdit(settings: Pick<GenSettings, 'backgroundEditMode' | 'revealOnEdit'>): OpenAfterEditMode {
	if (settings.backgroundEditMode) {
		return 'never';
	}

	return settings.revealOnEdit === 'focus' ? 'focus' : settings.revealOnEdit === 'preview' ? 'preview' : 'never';
}

export function applyOpenAfterEdit(
	mode: OpenAfterEditMode,
): Pick<GenSettings, 'backgroundEditMode' | 'revealOnEdit'> {
	if (mode === 'never') {
		return { 
			backgroundEditMode: true, 
			revealOnEdit: 'never' 
		};
	}

	return { 
		backgroundEditMode: false, 
		revealOnEdit: mode 
	};
}
