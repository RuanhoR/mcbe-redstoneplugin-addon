export type BlockStorageDBType = {
  [key: string]: string;
};

/**
 * 一条机器数据：机器方块位置 key -> 容器实体。
 * 仅保存在内存中，不会写入文件 / dynamic property。
 */
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
 * 内存版方块存储。
 *
 * 锁规则：place/delete 与维护 loop 不能同时写。所有写操作都必须先
 * 获取内存锁，获取失败则本次操作直接放弃。由于脚本是单线程同步执行，
 * 锁只是保证逻辑上不会出现"写期间再写"的情况。
 */
export class blockStorage {
  private static db: Map<string, BlockStorageData> = new Map();
  private static locked: boolean = false;

  public static isLocked(): boolean {
    return this.locked;
  }

  public static tryLock(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  public static unlock(): void {
    this.locked = false;
  }

  /** 写入一条数据（place）。获取不到锁则返回 false。 */
  public static placeData(key: string, data: BlockStorageData): boolean {
    if (!this.tryLock()) return false;
    try {
      this.db.set(key, data);
      return true;
    } finally {
      this.unlock();
    }
  }

  public static getData(key: string): BlockStorageData | undefined {
    return this.db.get(key);
  }

  public static has(key: string): boolean {
    return this.db.has(key);
  }

  /** 删除一条数据（delete）。获取不到锁则返回 undefined。 */
  public static deleteData(key: string): BlockStorageData | undefined {
    if (!this.tryLock()) return undefined;
    try {
      return this.deleteDataUnlocked(key);
    } finally {
      this.unlock();
    }
  }

  /** 移动一条数据（活塞推动）。获取不到锁则返回 false。 */
  public static moveData(oldKey: string, newKey: string): boolean {
    if (!this.tryLock()) return false;
    try {
      const data = this.db.get(oldKey);
      if (!data || this.db.has(newKey)) return false;
      this.db.delete(oldKey);
      this.db.set(newKey, data);
      return true;
    } finally {
      this.unlock();
    }
  }

  /**
   * 调用者必须已经持有锁时使用（用于维护 loop 内部清理）。
   */
  public static deleteDataUnlocked(key: string): BlockStorageData | undefined {
    const data = this.db.get(key);
    if (data) this.db.delete(key);
    return data;
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