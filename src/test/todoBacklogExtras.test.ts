import * as assert from 'node:assert/strict';
import { suite, test, suiteSetup } from 'mocha';
import { registerBuiltins } from '../features/agent/tools/builtins';
import { getToolByName } from '../features/agent/tools/registry';
import { htmlToMarkdown } from '../features/agent/tools/meta/htmlToMarkdown';
import { extractCommitSubjectForTests } from '../features/scm/generateCommitMessage';

suite('TODO backlog extras', () => {
	suiteSetup(() => {
		registerBuiltins();
	});

	test('htmlToMarkdown strips scripts and keeps headings', () => {
		const md = htmlToMarkdown('<html><script>x()</script><h1>Hi</h1><p>Hello <b>world</b></p></html>');
		assert.match(md, /# Hi/);
		assert.match(md, /Hello/);
		assert.doesNotMatch(md, /x\(\)/);
	});

	test('extractCommitSubject prefers first line / fence', () => {
		assert.equal(extractCommitSubjectForTests('```\nfix: add vault\n```'), 'fix: add vault');
		assert.equal(extractCommitSubjectForTests('feat: one\n\nbody'), 'feat: one');
	});

	test('new tools registered', () => {
		for (const name of [
			'web_fetch',
			'browser_action',
			'attempt_completion',
			'report_bug',
			'new_rule',
		]) {
			assert.ok(getToolByName(name), name);
		}
	});
});
