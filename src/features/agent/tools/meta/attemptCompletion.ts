import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';

// Формальный сигнал «задача выполнена» для agent loop / UI
export const attemptCompletionTool: ToolDefinition = {
	name: 'attempt_completion',
	description: 'Сигнал что задача выполнена. Передайте краткий result для пользователя. Не заменяет Accept/Reject правок.',
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
		const result = asString(args, 'result').trim() || '(done)';
		return {
			ok: true,
			content: JSON.stringify({ status: 'completed', result }, null, 2),
		};
	},
};
