type ActivityReward = {
    kind: string;
    name: string;
};
type ActivityItem = {
    id: string;
    name: string;
    desc: string;
    description: string;
    cover: string;
    start_ts: number;
    end_ts: number;
    start: string;
    end: string;
    statusText: string;
    statusClass: string;
    is_unlimited: boolean;
    is_perm: boolean;
    rewards: ActivityReward[];
    rewards_text: string;
    sort: number;
    time_label: string;
    hide_start?: boolean;
    left_pct?: number;
    width_pct?: number;
    theme?: string;
};
export declare class ActivitiesService {
    extractActivities(payload: any): ActivityItem[];
    buildRenderData(payload: any): {
        title: string;
        subtitle: string;
        activity_count: number;
        activities: ActivityItem[];
        lanes: {
            theme: string;
            id: string;
            name: string;
            desc: string;
            description: string;
            cover: string;
            start_ts: number;
            end_ts: number;
            start: string;
            end: string;
            statusText: string;
            statusClass: string;
            is_unlimited: boolean;
            is_perm: boolean;
            rewards: ActivityReward[];
            rewards_text: string;
            sort: number;
            time_label: string;
            hide_start?: boolean;
            left_pct?: number;
            width_pct?: number;
        }[][];
        axis_dates: {
            label: string;
            left_pct: number;
        }[];
        now_line: {
            label: string;
            left_pct: number;
        };
        empty: boolean;
        commandHint: string;
        copyright: string;
    };
    buildFallbackText(payload: any): string;
}
export {};
