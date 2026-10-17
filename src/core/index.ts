/**
 * Сервисы core для хоста (config / llm / stores / log).
 * Импортируй из `../core/config/...` и т.п.
 */
export { initSettings, getSettings } from './config/settings';
export type { GenSettings } from './config/settings';
export { HttpLlmClient } from './llm/client';
export { initLogger } from './log/logger';
export { initUsageStore } from './stores/usageStore';
export { initActivityStore } from './stores/activityStore';
