export type AnnouncementBlock = {
    text: string;
    image: string;
};
export declare function plainAnnouncementText(value: unknown): string;
export declare function buildAnnouncementView(data: any, baseUrl: string): {
    title: string;
    id: string;
    publishedAt: string;
    blocks: AnnouncementBlock[];
    commandHint: string;
    copyright: string;
};
export declare function announcementViewText(view: ReturnType<typeof buildAnnouncementView>): string;
export declare function buildAnnouncementListView(data: any, page: number): {
    title: string;
    page: number;
    items: any;
    commandHint: string;
    copyright: string;
};
