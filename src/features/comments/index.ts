import type { DiffContentProvider } from '../../host/preview/showDiff';
import { registerCommentFile } from './commentFile';
import { registerCommentSelection } from './commentSelection';

export { registerCommentFile } from './commentFile';
export { registerCommentSelection } from './commentSelection';
export { runCommentPipeline } from './runCommentPipeline';
export { buildCommentMessages } from './commentPrompt';
export { pickFewShot } from './commentFewShot';
export { extractCommentedCode } from './extractCommentedCode';
export { validateUnchangedCode, stripComments, resolveCommentStyleId, getCommentStyleConfig } from './validateUnchangedCode';
export type { CommentStyleConfig, CommentStyleId } from './validateUnchangedCode';

// Команды comment selection / file
export function registerCommentCommands(diffProvider: DiffContentProvider) {
	return [
		registerCommentSelection(diffProvider),
		registerCommentFile(diffProvider),
	];
}
