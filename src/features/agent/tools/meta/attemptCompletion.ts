import { getSettings } from '../../../../core/config/settings';
import { asString, makeToolError, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';

// Формальный сигнал «задача выполнена» для agent loop / UI
export const attemptCompletionTool: ToolDefinition = {
	name: 'attempt_completion',
	description: 'Сигнал что задача выполнена. Передайте краткий result для пользователя. Не заменяет Accept/Reject правок. При verifyGateCompletion и красных diagnostics после правок - отказ.',
	parameters: {
		type: 'object',
		properties: {
			result: { 
				type: 'string', 
				description: 'Краткий итог для пользователя' 
			},
		},
		required: ['result'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const settings = getSettings();
		const gate = (ctx as { lastVerifyHadErrors?: boolean }).lastVerifyHadErrors;
		if (settings.verifyGateCompletion && gate) {
			return makeToolError(
				'attempt_completion blocked: last edit verify still has diagnostics errors. Fix them (see Verify block) then retry.',
				{ 
					code: 'verify_gate', 
					category: 'validation', 
					retryable: true 
				},
			);
		}
		const result = asString(args, 'result').trim() || '(done)';
		return {
			ok: true,
			content: JSON.stringify({ status: 'completed', result }, null, 2),
		};
	},
};
