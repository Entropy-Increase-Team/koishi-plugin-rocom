import { PluginDeps } from '../types';
export declare function createCommunityHandlers(deps: PluginDeps): {
    queryExchangeList: ({ session }: any, page?: number) => Promise<string>;
    postExchange: ({ session }: any, args?: string) => Promise<string>;
    queryMyPosts: ({ session }: any) => Promise<string>;
    closePost: ({ session }: any, postIdArg: string, reason?: string) => Promise<string>;
    reviewStatus: ({ session }: any, postIdArg: string) => Promise<string>;
    subscribeEgg: ({ session }: any, filtersText?: string) => Promise<string>;
    listSubscriptions: ({ session }: any) => Promise<string>;
    unsubscribeEgg: ({ session }: any, subscriptionId?: string) => Promise<string>;
    queryEvents: ({ session }: any, subscriptionId: string, afterEventId?: string) => Promise<string>;
};
