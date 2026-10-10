import { PluginDeps } from '../types';
interface HomeEggPetStatus {
    petId: string;
    name: string;
    ready: boolean;
    remaining: string;
    predictedEggTime: number;
    hasEgg: boolean;
}
/**
 * 从 home/eggs 轻量接口响应中提取蛋状态（上游 WeGame rocom）。
 * 接口仍在开发中，这里对多种可能的字段名做兼容。
 */
export declare function extractHomeEggStatus(payload: any): {
    readyCount: number;
    totalEggs: number;
    pets: HomeEggPetStatus[];
};
export declare function register(deps: PluginDeps): void;
export {};
