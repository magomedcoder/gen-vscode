import type { TokenUsage } from './usage';
import type { LlmModelOption } from './modelLabel';

export type { TokenUsage, LlmModelOption };

export interface ToolFunctionSchema {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface LlmToolDefinition {
	type: 'function';
	function: ToolFunctionSchema;
}

export interface LlmToolCallFunction {
	name: string;
	arguments: string;
}

export interface LlmToolCall {
	id: string;
	type: 'function';
	function: LlmToolCallFunction;
}

// Часть multimodal user-сообщения (OpenAI-compatible)
export type ChatContentPart = | { 
	type: 'text'
	text: string
} | { 
	type: 'image_url'
	image_url: { 
		url: string 
	} 
};

export type ChatMessage = | {
		role: 'system' | 'user';
		content: string | ChatContentPart[];
	}
	| {
		role: 'assistant';
		content: string | null;
		tool_calls?: LlmToolCall[];
	}
	| {
		role: 'tool';
		tool_call_id: string;
		content: string;
		name?: string;
	};

export interface LlmRetryInfo {
	attempt: number;
	maxAttempts: number;
	status?: number;
	delayMs: number;
}

export interface CompleteParams {
	messages: ChatMessage[];
	signal?: AbortSignal;
	tools?: LlmToolDefinition[];
	toolChoice?: 'auto' | 'none' | 'required';
	onDelta?: (chunk: string) => void;
	// Поток reasoning/thinking, если провайдер отдаёт отдельное поле
	onThinkingDelta?: (chunk: string) => void;
	// Вызывается перед паузой между повторами HTTP-запроса
	onRetry?: (info: LlmRetryInfo) => void;
	// Переопределение модели (например smallModel для /compact)
	model?: string;
}

export interface CompleteResult {
	content: string;
	// Reasoning/thinking от модели (если провайдер отдал)
	thinking?: string;
	toolCalls?: LlmToolCall[];
	finishReason?: string;
	toolsFallback?: boolean; // если true запрос был повторен без инструментов, потому что сервер их отклонил
	usage?: TokenUsage;
}

export interface ListModelsParams {
	baseUrl?: string;
	signal?: AbortSignal;
}

// Capabilities, если сервер отдал в /v1/models (report-only)
export interface ConnectionCapabilities {
	contextLength?: number;
	toolsHint?: string;
}

// Результат GET /v1/models как health-probe соединения
export interface ConnectionHealthResult {
	ok: boolean;
	modelCount: number;
	message: string;
	capabilities?: ConnectionCapabilities;
}

export interface LlmClient {
	complete(params: CompleteParams): Promise<CompleteResult>;
	listModels(params?: ListModelsParams): Promise<string[]>;
	listModelOptions(params?: ListModelsParams): Promise<LlmModelOption[]>;
	// Лёгкий health check: GET /v1/models (тот же probe, что listModelOptions)
	checkConnectionHealth(params?: ListModelsParams): Promise<ConnectionHealthResult>;
}
