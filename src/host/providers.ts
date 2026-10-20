import type * as vscode from 'vscode';
import { registerInlineCompletionProvider } from '../features/tab/inlineComplete';
import { DiffContentProvider, registerDiffContentProvider } from './preview/showDiff';

export function registerHostProviders(): {
	diffProvider: DiffContentProvider;
	disposables: vscode.Disposable[];
} {
	const diffProvider = new DiffContentProvider();
	return {
		diffProvider,
		disposables: [
			registerDiffContentProvider(diffProvider),
			registerInlineCompletionProvider(),
		],
	};
}
