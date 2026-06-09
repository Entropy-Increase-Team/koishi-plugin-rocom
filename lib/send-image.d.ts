import { PluginConfig } from './types';
export declare function detectImageMime(image: Buffer): string;
export declare function compressPngImage(image: Buffer, config: Pick<PluginConfig, 'imageCompressionEnabled' | 'imageCompressionMinBytes' | 'imageCompressionLevel'>): Buffer;
export declare function sendImageWithFallback(session: any, image: Buffer | null, fallbackText: string, scene: string, compressionConfig?: Pick<PluginConfig, 'imageCompressionEnabled' | 'imageCompressionMinBytes' | 'imageCompressionLevel'>): Promise<void>;
