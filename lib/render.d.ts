import { Context } from 'koishi';
export interface RenderOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    imageWaitMs?: number;
    fontWaitMs?: number;
    deviceScaleFactor?: number;
    jpegQuality?: number;
    maxPageHeight?: number;
}
export declare const lowBandwidthRenderOptions: RenderOptions;
export declare class Renderer {
    private resPath;
    private defaults;
    constructor(resPath: string, defaults?: RenderOptions);
    resourceUrl(relativePath: string): string;
    private getPreferredResourceRoot;
    private getTemplateCandidateRoots;
    private resolveTemplatePath;
    private getStylePath;
    renderHtml(ctx: Context, templateName: string, data: any, options?: RenderOptions): Promise<Buffer | null>;
    renderPages(ctx: Context, templateName: string, data: any, options?: RenderOptions): Promise<Buffer[] | null>;
    private capture;
}
