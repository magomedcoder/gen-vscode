import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DetectedTestCommand {
	command: string;
	args: string[];
	label: string;
	runner: 'jest' | 'vitest' | 'node' | 'go' | 'cargo' | 'pytest' | 'django';
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readJson(filePath: string): Promise<Record<string, unknown> | undefined> {
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: undefined;
	} catch {
		return undefined;
	}
}

async function packageManager(cwd: string): Promise<'yarn' | 'pnpm' | 'npm'> {
	if (await fileExists(path.join(cwd, 'yarn.lock'))) {
		return 'yarn';
	}

	if (await fileExists(path.join(cwd, 'pnpm-lock.yaml'))) {
		return 'pnpm';
	}

	return 'npm';
}

async function detectFromPackageJson(cwd: string): Promise<DetectedTestCommand | undefined> {
	const pkg = await readJson(path.join(cwd, 'package.json'));
	const scripts = pkg?.scripts;
	if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
		return undefined;
	}

	const testScript = (scripts as Record<string, unknown>).test;
	if (typeof testScript !== 'string' || !testScript.trim()) {
		return undefined;
	}

	const pm = await packageManager(cwd);
	const runner = /\bvitest\b/.test(testScript)
		? 'vitest'
		: /\bjest\b/.test(testScript)
			? 'jest'
			: 'node';
	if (pm === 'yarn') {
		return {
			command: 'yarn',
			args: ['test'],
			label: 'yarn test',
			runner,
		};
	}

	if (pm === 'pnpm') {
		return {
			command: 'pnpm',
			args: ['test'],
			label: 'pnpm test',
			runner,
		};
	}

	return {
		command: 'npm',
		args: ['test'],
		label: 'npm test',
		runner,
	};
}

export async function detectTestCommand(cwd: string): Promise<DetectedTestCommand | undefined> {
	const fromPackage = await detectFromPackageJson(cwd);
	if (fromPackage) {
		return fromPackage;
	}

	if (await fileExists(path.join(cwd, 'go.mod'))) {
		return {
			command: 'go',
			args: ['test', './...'],
			label: 'go test ./...',
			runner: 'go',
		};
	}

	if (await fileExists(path.join(cwd, 'Cargo.toml'))) {
		return {
			command: 'cargo',
			args: ['test'],
			label: 'cargo test',
			runner: 'cargo',
		};
	}

	if (await fileExists(path.join(cwd, 'pytest.ini')) || await fileExists(path.join(cwd, 'pyproject.toml')) || await fileExists(path.join(cwd, 'setup.cfg'))) {
		return {
			command: 'pytest',
			args: [],
			label: 'pytest',
			runner: 'pytest',
		};
	}

	if (await fileExists(path.join(cwd, 'manage.py'))) {
		return {
			command: 'python',
			args: ['manage.py', 'test'],
			label: 'python manage.py test',
			runner: 'django',
		};
	}

	return undefined;
}
