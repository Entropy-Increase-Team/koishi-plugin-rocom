import { PluginDeps } from '../types';
export declare function getPrimaryToken(deps: PluginDeps, userId: string): Promise<string>;
export declare function notLoggedInHint(): string;
export declare function saveBindingWithRoleInfo(deps: PluginDeps, session: any, fwToken: string, loginType: string, userId: string, preMessageIds?: string[]): Promise<void>;
export declare function register(deps: PluginDeps): void;
