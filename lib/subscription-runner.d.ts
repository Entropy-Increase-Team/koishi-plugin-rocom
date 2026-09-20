import { Context } from 'koishi';
export interface Runner {
    <T>(job: (signal: AbortSignal) => Promise<T>): Promise<T | undefined>;
    aborted: () => boolean;
}
export declare function createRunner(ctx: Context): Runner;
