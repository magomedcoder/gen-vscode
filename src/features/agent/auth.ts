import type { ApprovalPolicy } from '../../core/config/approvalTypes';
import { getSettings } from '../../core/config/settings';

const WRITE_TOOLS = new Set([
	'write_file',
	'apply_patch',
	'apply_workspace_edit',
	'edit_file',
	'create_dir',
	'edit_notebook',
	'new_rule',
	'report_bug',
]);

const DELETE_TOOLS = new Set(['delete_file']);

export function isMutatingTool(name: string): boolean {
	return WRITE_TOOLS.has(name) || DELETE_TOOLS.has(name);
}

/**
 * Confirm на запись/удаление всегда через central executeAgentTool + confirmOrSkip:
 * skip - `skipConfirm` / `autoApprove` / approvalPolicy allow; edit-tools сами карточку не показывают.
 */
export function shouldConfirmWrites(): boolean {
	return true;
}

export function shouldConfirmDeletes(): boolean {
	return true;
}

// Режим «только чтение»: edits/delete/shell в approvalPolicy = deny
export function isReadOnlyApprovalPolicy(policy: ApprovalPolicy = getSettings().approvalPolicy): boolean {
	return policy.edits.mode === 'deny' && policy.delete.mode === 'deny' && policy.shell.mode === 'deny';
}
