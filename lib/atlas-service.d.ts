import { Context } from 'koishi';
export type AtlasProgressCallback = (percent: number, stage: string) => void | Promise<void>;
export declare class AtlasService {
    private dataDir;
    constructor(dataDir: string);
    get atlasDir(): string;
    private indexPath;
    private petsDir;
    private aliasPath;
    isReady(): boolean;
    loadIndex(): Record<string, string>;
    private stripYamlValue;
    loadPetAliases(): Record<string, string[]>;
    private localImagePath;
    private existingImagePath;
    findMatch(query: string): {
        name: string;
        imagePath: string;
        candidates: string[];
    };
    private prepareAtlasDir;
    private replaceAtlasDir;
    private downloadZipWithProgress;
    download(ctx: Context, progressCb?: AtlasProgressCallback): Promise<{
        imageCount: number;
        totalBytes: number;
    }>;
}
