export interface ClockParts {
    date: string;
    hour: number;
    minute: number;
    second: number;
}
export declare class MerchantClock {
    private formatter;
    private fixedOffset;
    readonly zone: string;
    constructor(requested?: string);
    parts(nowMs?: number): ClockParts;
    date(nowMs?: number): string;
    /** Boundaries in absolute time, including 23/25-hour DST days. */
    dayBounds(nowMs?: number): {
        start: number;
        end: number;
    };
    minuteOfDay(nowMs?: number): number;
    timeText(nowMs?: number): string;
    nextTimeFor(times: string[], nowMs?: number): number | null;
}
