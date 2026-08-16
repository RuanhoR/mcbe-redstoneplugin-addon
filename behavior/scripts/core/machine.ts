import {
  Block,
  BlockComponentRedstoneUpdateEvent,
  BlockCustomComponent,
  BlockPermutation,
  Container,
  Dimension,
  Entity,
  EntityInventoryComponent,
  ItemComponentTypes,
  ItemDurabilityComponent,
  ItemStack,
  Player,
  system,
  Vector3,
  world,
} from "@minecraft/server";
import { getBlockLoot } from "@ojang/vanilla-lootdata";
import { AddonBlock } from "../config";
import { blockStorage, BlockStorageEntry } from "./blockStorage";
import { locationKey, locationKeyToData } from "./utils";

export const CONTAINER_ENTITY_TYPE = "redstoneplugin:container_entity";
const CUSTOM_COMPONENT_ID = "redstoneplugin:controller";

const MACHINE_TYPES = new Set<string>([
  AddonBlock.PlaceBlock,
  AddonBlock.CutBlock,
]);

/** 维护循环的执行周期（tick） */
const MAINTENANCE_INTERVAL = 10;
/** 实体缺失后延迟复查的 tick 数 */
const ENTITY_RECHECK_DELAY = 4;
/** place 沿作业方向最多搜索的格子数 */
const PLACE_SEARCH_RANGE = 64;
/** 维护循环扫描玩家周围方块的半径（10*10 区域） */
const SCAN_RADIUS = 5;

/** 正在等待延迟复查实体是否存在的 key */
const pendingEntityChecks = new Set<string>();

/**
 * 机器工作（up）方向：一律为 facing_direction 的反方向。
 * 水平：方块朝西 -> 作业在东侧；垂直：放在地面（up）-> 向下，天花板（down）-> 向上。
 */
const FACING_TO_DIR: Record<string, Vector3> = {
  up: { x: 0, y: -1, z: 0 },
  down: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: 0, z: 1 },
  south: { x: 0, y: 0, z: -1 },
  west: { x: 1, y: 0, z: 0 },
  east: { x: -1, y: 0, z: 0 },
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
  const center = machine.location; // 直接放在机器方块中心
  const b = dim.getBlock(center);
  if (!b)
    return dim.spawnEntity<typeof CONTAINER_ENTITY_TYPE>(
      CONTAINER_ENTITY_TYPE,
      center,
    );
  if (b.isAir) {
    return dim.spawnEntity<typeof CONTAINER_ENTITY_TYPE>(
      CONTAINER_ENTITY_TYPE,
      center,
    );
  }
  // 机器方块本身不是空气（占位），实体无法生成在方块内 -> 回退到机器上方
  const above = add(machine.location, { x: 0, y: 1, z: 0 });
  const aboveBlock = dim.getBlock(above);
  if (aboveBlock && aboveBlock.isAir) {
    return dim.spawnEntity<typeof CONTAINER_ENTITY_TYPE>(
      CONTAINER_ENTITY_TYPE,
      above,
    );
  }
  return dim.spawnEntity<typeof CONTAINER_ENTITY_TYPE>(
    CONTAINER_ENTITY_TYPE,
    center,
  );
}

function getEntityContainer(entity: Entity): Container | undefined {
  const inv = entity.getComponent(EntityInventoryComponent.componentId) as
    | EntityInventoryComponent
    | undefined;
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
    try {
      entity.kill();
    } catch {
      /* ignore */
    }
  }
}

function teleportEntitySafe(entity: Entity, loc: Vector3): void {
  try {
    entity.teleport(loc);
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

/** 给工具扣 1 点耐久，耐久耗尽则销毁该工具 */
function damageTool(container: Container, slotIndex: number): void {
  const slot = container.getSlot(slotIndex);
  if (!slot.isValid) return;
  const item = slot.getItem();
  if (!item) return;
  const durability = item.getComponent(ItemComponentTypes.Durability) as
    | ItemDurabilityComponent
    | undefined;
  if (!durability || durability.maxDurability <= 0) return; // 无耐久组件
  durability.damage += 1;
  if (durability.damage >= durability.maxDurability) {
    slot.setItem(); // 耐久耗尽 -> 工具消失
  } else {
    slot.setItem(item);
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
      return; // 每次激活只放 1 格
    }
    pos = add(pos, dir);
  }
}

function machineCut(machine: Block, container: Container): void {
  const toolSlot = findToolSlot(container);
  if (toolSlot === undefined) return; // 背包里没有镐子/铲子
  const tool = container.getItem(toolSlot);
  if (!tool) return;
  const dir = getOperatingDirection(machine);
  const targetPos = add(machine.location, dir);
  const target = machine.dimension.getBlock(targetPos);
  if (!target || target.isAir || target.isLiquid) return;
  if (MACHINE_TYPES.has(target.typeId)) return; // 不破坏机器方块

  // 先按原版方块掉落规则计算战利品，再破坏方块
  const loot = getBlockLoot({
    type: "block",
    origin: target,
    useItem: tool,
    isSurvival: true,
    flags: { lootOrb: true },
  });
  try {
    target.setType("minecraft:air");
  } catch {
    return;
  }
  const dim = machine.dimension;
  for (const item of loot.items) {
    dim.spawnItem(item, targetPos);
  }
  if (loot.orb > 0) {
    dim.spawnEntity("minecraft:xp_orb", targetPos);
  }
  damageTool(container, toolSlot); // 扣耐久，而不是直接消耗掉工具
}

/** 红石激活入口（以方块动态属性为准） */
function machineActivate(machine: Block): void {
  const data = blockStorage.readFromBlock(machine);
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
  if (blockStorage.readFromBlock(machine)) return;
  const entity = spawnContainerEntity(machine);
  if (!entity) return;
  const type: "place" | "cut" =
    machine.typeId === AddonBlock.PlaceBlock ? "place" : "cut";
  entity.setDynamicProperty("redstoneplugin:machineKey", key);
  entity.setDynamicProperty("redstoneplugin:machineType", type);
  blockStorage.writeToBlock(machine, { entityId: entity.id, type });
  blockStorage.placeData(key, { entityId: entity.id, type });
}

function handleMachineRemoved(location: Vector3, dimension: Dimension): void {
  const key = locationKey(location, dimension);
  const block = dimension.getBlock(location);
  const data =
    (block && blockStorage.readFromBlock(block)) ||
    blockStorage.deleteData(key);
  if (block) blockStorage.clearBlock(block);
  blockStorage.deleteData(key);
  if (!data) return;
  const entity = getEntitySafe(data.entityId);
  if (!entity) return;
  // 先收集容器里的物品
  const container = getEntityContainer(entity);
  const items: ItemStack[] = [];
  if (container) {
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (!item) continue;
      container.setItem(i);
      items.push(item);
    }
  }
  // 必须先移除实体，避免后续 spawnItem 抛错导致实体残留
  removeEntitySafe(entity);
  for (const item of items) {
    try {
      dimension.spawnItem(item, location);
    } catch {
      /* ignore */
    }
  }
}

/** 在 pos 的 6 个相邻格寻找机器方块（活塞推动后 key 还没更新时的兜底） */
function findMachineBlockNeighbor(
  pos: Vector3,
  dim: Dimension,
): Block | undefined {
  const dirs: Vector3[] = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  for (const d of dirs) {
    try {
      const b = dim.getBlock(add(pos, d));
      if (b && MACHINE_TYPES.has(b.typeId)) return b;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * pos 或其 6 相邻格是否存在活塞移动中的方块。
 * 活塞推动期间方块 id 会临时变成 moving_block，飞行器等高频移动下机器方块
 * 长时间处于该状态，此时不能判定机器消失。
 */
function hasMovingBlockNearby(pos: Vector3, dim: Dimension): boolean {
  const dirs: Vector3[] = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  const check = (p: Vector3): boolean => {
    try {
      const b = dim.getBlock(p);
      if (!b) return false;
      return (
        b.typeId === "minecraft:moving_block" ||
        b.typeId === "minecraft:piston_arm_collision"
      );
    } catch {
      return false;
    }
  };
  if (check(pos)) return true;
  for (const d of dirs) {
    if (check(add(pos, d))) return true;
  }
  return false;
}

function resetEntry(entry: BlockStorageEntry, lockHeld: boolean): void {
  const entity = getEntitySafe(entry.data.entityId);
  if (entity) removeEntitySafe(entity);
  // 同步清除方块上的数据
  try {
    const [loc, dim] = locationKeyToData(entry.key);
    const block = dim.getBlock(loc);
    if (block) blockStorage.clearBlock(block);
  } catch {
    /* ignore */
  }
  if (lockHeld) blockStorage.deleteDataUnlocked(entry.key);
  else blockStorage.deleteData(entry.key);
}

// ---------- 活塞推动：机器方块被推动时 key 跟随移动 ----------

function handlePistonMove(block: Block, moveDir: Vector3): void {
  // 高频移动（飞行器）时 getAttachedBlocks 可能返回 moving_block，
  // key 移动是按位置计算，moving_block 也照常处理
  const isMachine =
    MACHINE_TYPES.has(block.typeId) ||
    block.typeId === "minecraft:moving_block";
  if (!isMachine) return;
  const currentKey = locationKey(block.location, block.dimension);

  // 事件触发时方块通常已经移动 -> 方块在当前位置，key 还在旧位置
  const oldKey = locationKey(sub(block.location, moveDir), block.dimension);
  if (blockStorage.has(oldKey) && !blockStorage.has(currentKey)) {
    moveMachineEntry(block, oldKey, currentKey, block.location);
    return;
  }
  // 事件触发时方块尚未移动 -> 提前把 key 移到目标位置
  if (blockStorage.has(currentKey)) {
    const newKey = locationKey(add(block.location, moveDir), block.dimension);
    moveMachineEntry(block, currentKey, newKey, add(block.location, moveDir));
  }
}

function moveMachineEntry(
  block: Block,
  oldKey: string,
  newKey: string,
  newLocation: Vector3,
): void {
  const data =
    blockStorage.getData(oldKey) || blockStorage.readFromBlock(block);
  if (!data) return;
  const entity = getEntitySafe(data.entityId);
  if (entity) {
    // 实体直接放在新位置方块中心
    teleportEntitySafe(entity, newLocation);
    entity.setDynamicProperty("redstoneplugin:machineKey", newKey);
  }
  blockStorage.moveData(oldKey, newKey);
}

/** 把容器实体对齐到机器方块中心（定时纠偏，应对活塞挤压 / 碰撞导致的位移） */
function alignEntityToMachine(entity: Entity, machine: Block): void {
  const target = machine.location;
  const cur = entity.location;
  // 误差小于 0.5 格视为已对齐，避免频繁瞬移抖动
  if (
    Math.abs(cur.x - target.x) < 0.5 &&
    Math.abs(cur.y - target.y) < 0.5 &&
    Math.abs(cur.z - target.z) < 0.5
  ) {
    return;
  }
  teleportEntitySafe(entity, target);
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
  const [loc, dim] = locationKeyToData(key);
  let block: Block | undefined;
  try {
    block = dim.getBlock(loc);
  } catch {
    return; // 区块未加载等情况，等待下一次维护循环
  }
  // 以方块动态属性为准
  const data =
    (block && blockStorage.readFromBlock(block)) || blockStorage.getData(key);
  if (!data) return;
  let blockAlive = false;
  try {
    blockAlive = !!block && MACHINE_TYPES.has(block.typeId);
  } catch {
    return;
  }
  if (!blockAlive) {
    // 活塞把机器推走了 -> key 可能还没更新，检查相邻格
    const neighbor = findMachineBlockNeighbor(loc, dim);
    if (neighbor) {
      const newKey = locationKey(neighbor.location, neighbor.dimension);
      if (blockStorage.moveData(key, newKey)) {
        const e = getEntitySafe(data.entityId);
        if (e) teleportEntitySafe(e, neighbor.location);
      }
      return;
    }
    // 机器可能正处于活塞移动中（moving_block）-> 跳过，等待下一次维护
    if (hasMovingBlockNearby(loc, dim)) return;
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
      // 只扫描所有玩家周围 10*10 区域，直接处理扫描到的机器
      for (const p of players) {
        const dim = p.dimension;
        let minY = -64;
        let maxY = 320;
        try {
          const range = dim.heightRange;
          minY = range.min;
          maxY = range.max;
        } catch {
          /* ignore */
        }
        const py = Math.floor(p.location.y);
        const y0 = Math.max(py - SCAN_RADIUS, minY);
        const y1 = Math.min(py + SCAN_RADIUS, maxY);
        for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
          for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
            for (let y = y0; y <= y1; y++) {
              const x = Math.floor(p.location.x) + dx;
              const z = Math.floor(p.location.z) + dz;
              const block = dim.getBlock({ x, y, z });
              if (!block || !MACHINE_TYPES.has(block.typeId)) continue;
              maintenanceHandleMachine(block);
            }
          }
        }
      }
    } finally {
      blockStorage.unlock();
    }
  }, MAINTENANCE_INTERVAL);
}

/**
 * 维护一个机器方块：
 * - 同步方块动态属性 -> registry 索引
 * - 方块有数据但实体缺失 -> 延迟复查
 * - 把实体拉回方块中心
 */
function maintenanceHandleMachine(block: Block): void {
  const key = locationKey(block.location, block.dimension);
  const blockData = blockStorage.readFromBlock(block);
  if (blockData) {
    // 以方块为准同步索引
    const regData = blockStorage.getData(key);
    if (!regData || regData.entityId !== blockData.entityId) {
      blockStorage.placeData(key, blockData);
    }
    // 校验实体
    const entity = getEntitySafe(blockData.entityId);
    if (!entity) {
      scheduleEntityRecheck(key);
      return;
    }
    alignEntityToMachine(entity, block);
    return;
  }
  // 方块上没有数据但索引里有 -> 尝试补写（放置事件可能漏写）
  const regData = blockStorage.getData(key);
  if (regData) blockStorage.writeToBlock(block, regData);
}

// ---------- 红石组件 ----------

const redstoneController: BlockCustomComponent = {
  onRedstoneUpdate(event: BlockComponentRedstoneUpdateEvent): void {
    if (event.powerLevel < 1) return;
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
    for (const block of attached) {
      handlePistonMove(block, moveDir);
    }
  });

  startMaintenanceLoop();
}
