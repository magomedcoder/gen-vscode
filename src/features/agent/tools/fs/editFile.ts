import { asBoolean, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { applyPatchTool } from './applyPatch';
import { writeFileTool } from './writeFile';

/**
 * Удобный DSL поверх write_file / apply_patch:
 * - content без old_string -> write_file
 * - old_string + new_string -> apply_patch (замена фрагмента)
 */
export const editFileTool: ToolDefinition = {
	name: 'edit_file',
	description: 'Правка файла: либо полная запись (content), либо замена old_string->new_string (как apply_patch). Для нового файла передай content без old_string.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к файлу',
			},
			content: {
				type: 'string',
				description: 'Полное содержимое (режим write_file; не совмещать с old_string)',
			},
			old_string: {
				type: 'string',
				description: 'Фрагмент для замены (режим apply_patch)',
			},
			new_string: {
				type: 'string',
				description: 'Новый фрагмент (режим apply_patch)',
			},
			replace_all: {
				type: 'boolean',
				description: 'Заменить все вхождения (только patch-режим)',
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		const path = asString(args, 'path').trim();
		if (!path) {
			return {
				ok: false,
				content: 'edit_file: нужен path',
			};
		}

		const hasOld = typeof args.old_string === 'string';
		const hasContent = typeof args.content === 'string';

		if (hasOld && hasContent) {
			return {
				ok: false,
				content: 'edit_file: укажи либо content (полная запись), либо old_string+new_string (patch), не оба сразу',
			};
		}

		if (hasOld) {
			const newString = typeof args.new_string === 'string' ? args.new_string : undefined;
			if (newString === undefined) {
				return {
					ok: false,
					content: 'edit_file: для patch нужен new_string',
				};
			}

			return applyPatchTool.execute(
				{
					path,
					old_string: asString(args, 'old_string'),
					new_string: newString,
					replace_all: asBoolean(args, 'replace_all'),
				},
				ctx,
			);
		}

		if (hasContent) {
			return writeFileTool.execute(
				{
					path,
					content: asString(args, 'content'),
				},
				ctx,
			);
		}

		return {
			ok: false,
			content: 'edit_file: нужен content или пара old_string+new_string',
		};
	},
};
