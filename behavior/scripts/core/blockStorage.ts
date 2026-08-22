import {
  Block,
  BlockComponentTypes,
  BlockDynamicPropertiesComponent,
} from "@minecraft/server";
import { DP_KEY } from "../config";

export type BlockStorageData = {
  /** 容器实体唯一 id */
  entityId: string;
  /** 机器类型: place 或 cut */
  type: "place" | "cut";
};

export type BlockStorageEntry = {
  key: string;
  data: BlockStorageData;
};

/**
 * 中心仓库索引。
 *
 * 权威数据存在机器方块的 block entity 动态属性（minecraft:dynamic_properties）
 * 上，随方块持久化、世界重载不丢、活塞推动自动跟随。内存 Map 只是索引，
 * 由维护循环每 10t 扫描玩家周围区域同步更新。
 *
 * SAPI 单线程 run-to-completion：事件回调之间不会交错执行，无需加锁。
 */
export class blockStorage {
  private static db: Map<string, BlockStorageData> = new Map();

  // ---------- 方块动态属性读写（权威） ----------

  private static getDP(
    block: Block,
  ): BlockDynamicPropertiesComponent | undefined {
    try {
      return block.getComponent(BlockComponentTypes.DynamicProperties) as
        | BlockDynamicPropertiesComponent
        | undefined;
    } catch {
      return undefined;
    }
  }

  /** 从方块读取机器数据（undefined 表示该方块不是机器/未初始化） */
  public static readFromBlock(block: Block): BlockStorageData | undefined {
    const dp = this.getDP(block);
    if (!dp) return undefined;
    const entityId = dp.get(DP_KEY);
    if (typeof entityId !== "string") return undefined;
    const type = dp.get(DP_KEY + ":type");
    if (type !== "place" && type !== "cut") return undefined;
    return { entityId, type };
  }

  /** 把机器数据写入方块（place 时调用） */
  public static writeToBlock(block: Block, data: BlockStorageData): void {
    const dp = this.getDP(block);
    if (!dp) return;
    dp.set(DP_KEY, data.entityId);
    dp.set(DP_KEY + ":type", data.type);
  }

  /** 清除方块上的机器数据（破坏/重置时调用） */
  public static clearBlock(block: Block): void {
    const dp = this.getDP(block);
    if (!dp) return;
    dp.set(DP_KEY, undefined);
    dp.set(DP_KEY + ":type", undefined);
  }

  // ---------- 内存索引 ----------

  /** 写入索引（place 时调用） */
  public static placeData(key: string, data: BlockStorageData): boolean {
    this.db.set(key, data);
    return true;
  }

  public static getData(key: string): BlockStorageData | undefined {
    return this.db.get(key);
  }

  public static has(key: string): boolean {
    return this.db.has(key);
  }

  /** 删除索引（delete 时调用） */
  public static deleteData(key: string): BlockStorageData | undefined {
    const data = this.db.get(key);
    if (data) this.db.delete(key);
    return data;
  }

  /** 移动索引（活塞推动时调用） */
  public static moveData(oldKey: string, newKey: string): boolean {
    const data = this.db.get(oldKey);
    if (!data || this.db.has(newKey)) return false;
    this.db.delete(oldKey);
    this.db.set(newKey, data);
    return true;
  }

  /** 返回所有条目的快照 */
  public static getAll(): BlockStorageEntry[] {
    const out: BlockStorageEntry[] = [];
    for (const [key, data] of this.db) {
      out.push({ key, data });
    }
    return out;
  }
}
