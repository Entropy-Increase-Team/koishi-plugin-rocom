import { Context } from 'koishi';
export declare class Renderer {
    private resPath;
    constructor(resPath: string);
    resourceUrl(relativePath: string): string;
    private getPreferredResourceRoot;
    private getTemplateCandidateRoots;
    private resolveTemplatePath;
    private getStylePath;
    renderHtml(ctx: Context, templateName: string, data: any): Promise<Buffer | null>;
}
