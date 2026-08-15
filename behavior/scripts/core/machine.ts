import {
  Block,
  BlockComponentRedstoneUpdateEvent,
  BlockCustomComponent,
  BlockPermutation,
  Container,
  Dimension,
  Entity,
  EntityInventoryComponent,
  Player,
  system,
  Vector3,
  world,
} from "@minecraft/server";
import { AddonBlock } from "../config";
import { blockStorage, BlockStorageEntry } from "./blockStorage";
import { locationKey, locationKeyToData } from "./utils";

export const CONTAINER_ENTITY_TYPE = "redstoneplugin:container_entity";
const CUSTOM_COMPONENT_ID = "redstoneplugin:controller";

const MACHINE_TYPES = new Set<string>([AddonBlock.PlaceBlock, AddonBlock.CutBlock]);

/** 维护循环的执行周期（tick） */
const MAINTENANCE_INTERVAL = 10;
/** 实体缺失后延迟复查的 tick 数 */
const ENTITY_RECHECK_DELAY = 4;
/** 玩家 x/z 检索半径 */
const PLAYER_RANGE = 128;
/** place 最多向后搜索的格子数 */
const PLACE_SEARCH_RANGE = 64;

/** 正在等待延迟复查实体是否存在的 key */
const pendingEntityChecks = new Set<string>();

/**
 * 机器"up方向"（模型 up 面在世界空间中的朝向）：
 * 依据方块的 facing_direction 而定，并非简单 y+1。
 * 水平朝向 -> 面朝方向；垂直朝向（放在地面/天花板）-> 反向。
 */
const FACING_TO_DIR: Record<string, Vector3> = {
  up: { x: 0, y: -1, z: 0 },
  down: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
};

/** 原生活塞的 facing_direction 是数字状态 */
const PISTON_FACING_NUM: Record<number, Vector3> = {
  0: { x: 0, y: -1, z: 0 }, // down
  1: { x: 0, y: 1, z: 0 }, // up
  2: { x: 0, y: 0, z: -1 }, // north
  3: { x: 0, y: 0, z: 1 }, // south
  4: { x: -1, y: 0, z: 0 }, // west
  5: { x: 1, y: 0, z: 0 }, // east
};

// ---------- 向量工具 ----------

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function neg(a: Vector3): Vector3 {
  return { x: -a.x, y: -a.y, z: -a.z };
}

// ---------- 方向解析 ----------

function getFacingDirection(block: Block): string {
  const state = block.permutation.getState("minecraft:facing_direction") as
    | string
    | number
    | undefined;
  return state === undefined ? "" : String(state);
}

/** 机器工作（up）方向 */
function getOperatingDirection(block: Block): Vector3 {
  return FACING_TO_DIR[getFacingDirection(block)] ?? { x: 0, y: -1, z: 0 };
}

function getPistonFacing(block: Block): Vector3 | undefined {
  const state = block.permutation.getState("facing_direction");
  if (typeof state === "number") return PISTON_FACING_NUM[state];
  if (typeof state === "string") return FACING_TO_DIR[state];
  return undefined;
}

// ---------- 实体 / 容器 ----------

function spawnContainerEntity(machine: Block): Entity | undefined {
  const dim = machine.dimension;
  const dir = getOperatingDirection(machine);
  const behind = sub(machine.location, dir); // 机器背面（开放侧）
  const above = add(machine.location, { x: 0, y: 1, z: 0 });
  const candidates = [behind, above];
  for (const pos of candidates) {
    const b = dim.getBlock(pos);
    if (b && b.isAir) {
      return dim.spawnEntity<typeof CONTAINER_ENTITY_TYPE>(CONTAINER_ENTITY_TYPE, pos);
    }
  }
  return dim.spawnEntity<typeof CONTAINER_ENTITY_TYPE>(CONTAINER_ENTITY_TYPE, behind);
}

function getEntityContainer(entity: Entity): Container | undefined {
  const inv = entity.getComponent(
    EntityInventoryComponent.componentId,
  ) as EntityInventoryComponent | undefined;
  return inv?.container;
}

function getEntitySafe(id: string): Entity | undefined {
  try {
    return world.getEntity(id);
  } catch {
    return undefined;
  }
}

function removeEntitySafe(entity: Entity): void {
  try {
    entity.remove();
  } catch {
    /* ignore */
  }
}

/** 从容器中消耗第 slot 格的一格物品 */
function consumeItem(container: Container, slotIndex: number): void {
  const slot = container.getSlot(slotIndex);
  if (!slot.isValid) return;
  if (slot.amount > 1) {
    slot.amount = slot.amount - 1;
  } else {
    slot.setItem();
  }
}

/** 该 typeId 是否为可放置方块 */
function isPlaceableBlock(typeId: string): boolean {
  try {
    BlockPermutation.resolve(typeId);
    return true;
  } catch {
    return false;
  }
}

/** 寻找容器中第一个可放置的方块物品 */
function findBlockItemSlot(container: Container): number | undefined {
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    if (isPlaceableBlock(item.typeId)) return i;
  }
  return undefined;
}

/** 寻找容器中的镐子/铲子 */
function findToolSlot(container: Container): number | undefined {
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    const id = item.typeId;
    if (id.includes("_pickaxe") || id.includes("_shovel")) return i;
  }
  return undefined;
}

// ---------- place / cut 执行 ----------

function machinePlace(machine: Block, container: Container): void {
  const dir = getOperatingDirection(machine);
  let pos = add(machine.location, dir); // up方向前面一格
  for (let i = 0; i < PLACE_SEARCH_RANGE; i++) {
    const cell = machine.dimension.getBlock(pos);
    if (!cell) return;
    if (cell.isAir || cell.isLiquid) {
      const slot = findBlockItemSlot(container);
      if (slot === undefined) return; // 没有可放置的方块物品
      const item = container.getItem(slot);
      if (!item) return;
      try {
        cell.setType(item.typeId);
      } catch {
        return;
      }
      consumeItem(container, slot);
      return;
    }
    pos = add(pos, dir); // 这一格有方块则忽视，继续往后
  }
}

function machineCut(machine: Block, container: Container): void {
  const toolSlot = findToolSlot(container);
  if (toolSlot === undefined) return; // 背包里没有镐子/铲子
  const dir = getOperatingDirection(machine);
  const targetPos = add(machine.location, dir);
  const target = machine.dimension.getBlock(targetPos);
  if (!target || target.isAir || target.isLiquid) return;
  if (MACHINE_TYPES.has(target.typeId)) return; // 不破坏机器方块
  try {
    target.setType("minecraft:air");
  } catch {
    return;
  }
  consumeItem(container, toolSlot);
}

/** 红石激活入口 */
function machineActivate(machine: Block): void {
  const key = locationKey(machine.location, machine.dimension);
  const data = blockStorage.getData(key);
  if (!data) return;
  const entity = getEntitySafe(data.entityId);
  if (!entity) return;
  const container = getEntityContainer(entity);
  if (!container) return;
  if (data.type === "place") {
    machinePlace(machine, container);
  } else {
    machineCut(machine, container);
  }
}

// ---------- 放置 / 破坏 ----------

function handleMachinePlaced(machine: Block): void {
  const key = locationKey(machine.location, machine.dimension);
  if (blockStorage.has(key)) return;
  const entity = spawnContainerEntity(machine);
  if (!entity) return;
  const type: "place" | "cut" =
    machine.typeId === AddonBlock.PlaceBlock ? "place" : "cut";
  entity.setDynamicProperty("redstoneplugin:machineKey", key);
  entity.setDynamicProperty("redstoneplugin:machineType", type);
  blockStorage.placeData(key, { entityId: entity.id, type });
}

function handleMachineRemoved(location: Vector3, dimension: Dimension): void {
  const key = locationKey(location, dimension);
  const data = blockStorage.deleteData(key);
  if (!data) return;
  const entity = getEntitySafe(data.entityId);
  if (entity) removeEntitySafe(entity);
}

// ---------- 活塞推动：实体与 key 跟随移动 ----------

function handlePistonMove(
  block: Block,
  moveDir: Vector3,
  processed: Set<string>,
): void {
  if (!MACHINE_TYPES.has(block.typeId)) return;
  const currentKey = locationKey(block.location, block.dimension);
  if (processed.has(currentKey)) return;
  const oldKey = locationKey(sub(block.location, moveDir), block.dimension);

  // 情况 1：方块已经被推到新位置，key 还在旧位置 -> 移到当前位置
  if (blockStorage.has(oldKey) && !blockStorage.has(currentKey)) {
    moveMachineEntry(block, oldKey, currentKey, block.location);
    processed.add(currentKey);
    return;
  }
  // 情况 2：事件触发时方块尚未移动 -> 提前把 key/实体移到目标位置
  if (blockStorage.has(currentKey)) {
    const newKey = locationKey(add(block.location, moveDir), block.dimension);
    moveMachineEntry(block, currentKey, newKey, add(block.location, moveDir));
    processed.add(newKey);
  }
}

function moveMachineEntry(
  block: Block,
  oldKey: string,
  newKey: string,
  newLocation: Vector3,
): void {
  const data = blockStorage.getData(oldKey);
  if (!data) return;
  const entity = getEntitySafe(data.entityId);
  if (entity) {
    const dir = getOperatingDirection(block);
    const target = sub(newLocation, dir); // 跟随到机器背面
    try {
      entity.teleport(target);
    } catch {
      /* ignore */
    }
    entity.setDynamicProperty("redstoneplugin:machineKey", newKey);
  }
  blockStorage.moveData(oldKey, newKey);
}

// ---------- 维护循环 ----------

function isNearAnyPlayer(loc: Vector3, players: Player[]): boolean {
  for (const p of players) {
    const pl = p.location;
    if (Math.abs(pl.x - loc.x) <= PLAYER_RANGE && Math.abs(pl.z - loc.z) <= PLAYER_RANGE) {
      return true;
    }
  }
  return false;
}

function resetEntry(entry: BlockStorageEntry, lockHeld: boolean): void {
  const entity = getEntitySafe(entry.data.entityId);
  if (entity) removeEntitySafe(entity);
  if (lockHeld) blockStorage.deleteDataUnlocked(entry.key);
  else blockStorage.deleteData(entry.key);
}

function cleanupEntry(entry: BlockStorageEntry): void {
  resetEntry(entry, true);
}

/** 实体缺失：延迟 4t 再确认，若仍不存在则重置该机器 */
function scheduleEntityRecheck(key: string): void {
  if (pendingEntityChecks.has(key)) return;
  pendingEntityChecks.add(key);
  system.runTimeout(() => {
    pendingEntityChecks.delete(key);
    verifyEntityExists(key);
  }, ENTITY_RECHECK_DELAY);
}

function verifyEntityExists(key: string): void {
  const data = blockStorage.getData(key);
  if (!data) return;
  const [loc, dim] = locationKeyToData(key);
  let blockAlive = false;
  try {
    const block = dim.getBlock(loc);
    blockAlive = !!block && MACHINE_TYPES.has(block.typeId);
  } catch {
    return; // 区块未加载等情况，等待下一次维护循环
  }
  if (!blockAlive) {
    resetEntry({ key, data }, false);
    return;
  }
  if (!getEntitySafe(data.entityId)) {
    // 4t 后实体仍然不存在 -> 重置
    resetEntry({ key, data }, false);
  }
}

function startMaintenanceLoop(): void {
  system.runInterval(() => {
    // 锁：place/delete 与 loop 不能同时写
    if (!blockStorage.tryLock()) return;
    try {
      const players = world.getAllPlayers();
      const entries = blockStorage.getAll();
      for (const entry of entries) {
        const [loc, dim] = locationKeyToData(entry.key);

        if (!isNearAnyPlayer(loc, players)) continue;

        // 机器方块是否还存在
        let blockAlive = false;
        try {
          const block = dim.getBlock(loc);
          blockAlive = !!block && MACHINE_TYPES.has(block.typeId);
        } catch {
          blockAlive = true; // 区块未加载等情况，不清理
        }

        if (!blockAlive) {
          // 方块不在了 -> 直接重置
          cleanupEntry(entry);
          continue;
        }

        // 方块还在但容器实体不在了 -> 延迟复查，不立即清理
        if (!getEntitySafe(entry.data.entityId)) {
          scheduleEntityRecheck(entry.key);
        }
      }
    } finally {
      blockStorage.unlock();
    }
  }, MAINTENANCE_INTERVAL);
}

// ---------- 红石组件 ----------

const redstoneController: BlockCustomComponent = {
  onRedstoneUpdate(event: BlockComponentRedstoneUpdateEvent): void {
    // 第一次更新（放置/区块加载）与下降沿不响应
    if (event.firstUpdate) return;
    if (event.previousPowerLevel !== 0 || event.powerLevel < 1) return;
    if (!MACHINE_TYPES.has(event.block.typeId)) return;
    machineActivate(event.block);
  },
};

// ---------- 初始化 ----------

export function initMachineSystem(): void {
  system.beforeEvents.startup.subscribe((initEvent) => {
    initEvent.blockComponentRegistry.registerCustomComponent(
      CUSTOM_COMPONENT_ID,
      redstoneController,
    );
  });

  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (!MACHINE_TYPES.has(event.block.typeId)) return;
    handleMachinePlaced(event.block);
  });

  world.afterEvents.playerBreakBlock.subscribe((event) => {
    if (!MACHINE_TYPES.has(event.brokenBlockPermutation.type.id)) return;
    handleMachineRemoved(event.block.location, event.dimension);
  });

  world.afterEvents.pistonActivate.subscribe((event) => {
    const facing = getPistonFacing(event.piston.block);
    if (!facing) return;
    const moveDir = event.isExpanding ? facing : neg(facing);
    let attached: Block[] = [];
    try {
      attached = event.piston.getAttachedBlocks();
    } catch {
      return;
    }
    const processed = new Set<string>();
    for (const block of attached) {
      handlePistonMove(block, moveDir, processed);
    }
  });

  startMaintenanceLoop();
}