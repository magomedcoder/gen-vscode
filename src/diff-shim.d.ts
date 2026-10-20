declare module 'diff' {
	export interface StructuredHunk {
		oldStart: number;
		oldLines: number;
		newStart: number;
		newLines: number;
		lines: string[];
	}

	export interface ParsedDiff {
		index?: string;
		oldFileName?: string;
		newFileName?: string;
		oldHeader?: string;
		newHeader?: string;
		hunks: StructuredHunk[];
	}

	export interface ApplyOptions {
		fuzzFactor?: number;
		autoConvertLineEndings?: boolean;
		compareLine?: (
			lineNumber: number,
			line: string,
			operation: string,
			patchContent: string,
		) => boolean;
	}

	export function parsePatch(diffText: string): ParsedDiff[];
	export function applyPatch(
		source: string,
		uniDiff: string | ParsedDiff | ParsedDiff[],
		options?: ApplyOptions,
	): string | false;
	export function createTwoFilesPatch(
		oldFileName: string,
		newFileName: string,
		oldStr: string,
		newStr: string,
		oldHeader?: string,
		newHeader?: string,
		options?: { 
			context?: number 
		},
	): string;
}
