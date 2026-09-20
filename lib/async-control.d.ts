/** A deadline cancels the underlying operation as well as the caller's wait. */
export declare function withDeadline<T>(timeoutMs: number, parent: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>, onAbort?: () => void): Promise<T>;
export declare function delay(ms: number, signal?: AbortSignal): Promise<void>;
