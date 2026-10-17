import { Jimp } from 'jimp';
import type { ImageQualityPreset } from '../../core/config/types';

const QUALITY: Record<ImageQualityPreset, { quality: number; scale: number }> = {
	low: { 
		quality: 55, 
		scale: 0.65 
	},
	medium: { 
		quality: 75, 
		scale: 1 
	},
	high: { 
		quality: 90, 
		scale: 1 
	},
};

export interface ResizeImageOptions {
	maxWidth: number;
	maxHeight: number;
	quality: ImageQualityPreset;
	maxBytes?: number;
}

export async function resizeImageHost(
	input: Uint8Array,
	mimeType: string,
	options: ResizeImageOptions,
): Promise<{ bytes: Uint8Array; mimeType: string; resized: boolean; warning?: string }> {
	try {
		const preset = QUALITY[options.quality];
		const width = Math.max(64, Math.floor(options.maxWidth * preset.scale));
		const height = Math.max(64, Math.floor(options.maxHeight * preset.scale));
		const normalizedMime = mimeType.toLowerCase();
		const image = await Jimp.read(Buffer.from(input));
		if (image.width > width || image.height > height) {
			image.scaleToFit({ w: width, h: height });
		}

		const outputMime = normalizedMime.includes('png') ? 'image/png' : 'image/jpeg';
		const bytes = outputMime === 'image/jpeg'
			? await image.getBuffer('image/jpeg', { quality: preset.quality })
			: await image.getBuffer('image/png');
		if (options.maxBytes && bytes.byteLength > options.maxBytes) {
			return { 
				bytes: input, 
				mimeType, 
				resized: false, 
				warning: `resized image still exceeds ${options.maxBytes} bytes` 
			};
		}

		return { 
			bytes, 
			mimeType: outputMime, 
			resized: bytes.byteLength !== input.byteLength 
		};
	} catch (error) {
		return {
			bytes: input,
			mimeType,
			resized: false,
			warning: `host image resize skipped: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
