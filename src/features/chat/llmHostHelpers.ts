import { getSettings, setSessionModel } from '../../core/config/settings';
import { isAbortError } from '../../core/llm/errors';
import type { LlmClient } from '../../core/llm/types';
import type { ToWebviewMessage } from './protocol';

// Ответы loadModels / checkConnection для webview
export type LlmHostReply = Extract<ToWebviewMessage, {
	type: 'models' | 'modelsError' | 'connectionHealth'
}>;
export type LlmHostPost = (message: LlmHostReply) => void;

/**
 * Общие обработчики loadModels / checkConnection для ChatViewProvider и SettingsPanel.
 * Владеет одним AbortController: новый запрос отменяет предыдущий, устаревший ответ не постится.
 */
export class LlmHostRequests {
	private abortController?: AbortController;

	constructor(
		private readonly client: Pick<LlmClient, 'listModelOptions' | 'checkConnectionHealth'>,
		private readonly post: LlmHostPost,
	) {}

	// Отменить текущий запрос (dispose панели / вью)
	abort(): void {
		this.abortController?.abort();
	}

	private begin(): AbortController {
		this.abortController?.abort();
		const controller = new AbortController();
		this.abortController = controller;
		return controller;
	}

	private end(controller: AbortController): void {
		if (this.abortController === controller) {
			this.abortController = undefined;
		}
	}

	async checkConnection(baseUrl: string, requestId: number): Promise<void> {
		const controller = this.begin();
		try {
			const health = await this.client.checkConnectionHealth({
				baseUrl,
				signal: controller.signal,
			});
			if (controller.signal.aborted) {
				return;
			}

			this.post({
				type: 'connectionHealth',
				ok: health.ok,
				modelCount: health.modelCount,
				message: health.message,
				requestId,
				capabilities: health.capabilities,
			});
		} catch (err) {
			if (isAbortError(err) || controller.signal.aborted) {
				return;
			}

			this.post({
				type: 'connectionHealth',
				ok: false,
				modelCount: 0,
				message: err instanceof Error ? err.message : String(err),
				requestId,
			});
		} finally {
			this.end(controller);
		}
	}

	async loadModels(baseUrl: string, requestId: number): Promise<void> {
		const controller = this.begin();
		try {
			const models = await this.client.listModelOptions({
				baseUrl,
				signal: controller.signal,
			});
			if (controller.signal.aborted) {
				return;
			}

			if (models.length > 0) {
				const current = getSettings().model;
				if (!current || !models.some((item) => item.id === current)) {
					setSessionModel(models[0].id);
				}
			}

			this.post({
				type: 'models',
				models,
				requestId,
			});
		} catch (err) {
			if (isAbortError(err) || controller.signal.aborted) {
				return;
			}

			this.post({
				type: 'modelsError',
				message: err instanceof Error ? err.message : String(err),
				requestId,
			});
		} finally {
			this.end(controller);
		}
	}
}
