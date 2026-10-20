import type * as vscode from 'vscode';
import { registerCommentCommands } from '../features/comments';
import { registerGenerateCommitMessage } from '../features/scm/generateCommitMessage';
import type { DiffContentProvider } from './preview/showDiff';

export function registerHostCommands(diffProvider: DiffContentProvider): vscode.Disposable[] {
	return [
		...registerCommentCommands(diffProvider),
		registerGenerateCommitMessage(),
	];
}
