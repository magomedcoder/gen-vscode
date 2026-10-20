// Минимальные типы для optional dependency `playwright` (не в VSIX)
declare module 'playwright' {
	export interface PageScreenshotOptions {
		type?: 'png';
		fullPage?: boolean;
		timeout?: number;
	}

	export interface LocatorScreenshotOptions {
		type?: 'png';
		timeout?: number;
	}

	export interface Locator {
		first(): Locator;
		waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
		screenshot(options?: LocatorScreenshotOptions): Promise<Buffer>;
	}

	export interface Page {
		goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
		waitForLoadState(state?: string, options?: { timeout?: number }): Promise<void>;
		locator(selector: string): Locator;
		screenshot(options?: PageScreenshotOptions): Promise<Buffer>;
	}

	export interface Browser {
		newPage(): Promise<Page>;
		close(): Promise<void>;
	}

	export interface BrowserType {
		launch(options?: { headless?: boolean }): Promise<Browser>;
	}

	export const chromium: BrowserType;
}
