import {
  Block,
  BlockComponentRedstoneUpdateEvent,
  BlockCustomComponent,
  BlockInventoryComponent,
  Container,
  Dimension,
  Entity,
  ItemComponentTypes,
  ItemInventoryComponent,
  ItemStack,
  system,
  Vector3,
  world,
} from "@minecraft/server";
import { getBlockLoot } from "@ojang/vanilla-lootdata";
import { AddonBlock } from "../config";
import {
  CONTAINER_ENTITY_TYPE,
  CUSTOM_COMPONENT_ID,
  DP_KEY,
  ENTITY_RECHECK_DELAY,
  MACHINE_TYPES,
  MAINTENANCE_INTERVAL,
  PLACE_SEARCH_RANGE,
  SCAN_RADIUS,
} from "../config";
import { blockStorage, BlockStorageEntry } from "./blockStorage";
import { consumeItem, damageTool, findBlockItemSlot, findToolSlot } from "./container";
import {
  add,
  alignEntityToMachine,
  findMachineBlockNeighbor,
  getEntityContainer,
  getEntitySafe,
  getOperatingDirection,
  getPistonFacing,
  hasMovingBlockNearby,
  locationKey,
  locationKeyToData,
  neg,
  removeEntitySafe,
  spawnContainerEntity,
  sub,
  teleportEntitySafe,
} from "./utils";

const pendingEntityChecks = new Set<string>();

// ---------- place / cut 执行 ----------

function machinePlace(machine: Block, container: Container): void {
  const dir = getOperatingDirection(machine);
  let pos = add(machine.location, dir);
  for (let i = 0; i < PLACE_SEARCH_RANGE; i++) {
    const cell = machine.dimension.getBlock(pos);
    if (!cell) return;
    if (cell.isAir || cell.isLiquid) {
      const slot = findBlockItemSlot(container);
      if (slot === undefined) return;
      const item = container.getItem(slot);
      if (!item) return;
      try {
        cell.setType(item.typeId);
      } catch {
        return;
      }
      // 同步物品库存到方块（如潜影盒内容物）
      syncItemInventoryToBlock(item, cell);
      consumeItem(container, slot);
      return; // 每次激活只放 1 格
    }
    pos = add(pos, dir);
  }
}

function machineCut(machine: Block, container: Container): void {
  const toolSlot = findToolSlot(container);
  if (toolSlot === undefined) return;
  const tool = container.getItem(toolSlot);
  if (!tool) return;
  const dir = getOperatingDirection(machine);
  const targetPos = add(machine.location, dir);
  const target = machine.dimension.getBlock(targetPos);
  if (!target || target.isAir || target.isLiquid) return;
  if (MACHINE_TYPES.has(target.typeId)) return;

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
  damageTool(container, toolSlot);
}

// ---------- 红石激活 ----------

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

/** 把物品的库存同步到放置后的方块（如潜影盒内容物） */
function syncItemInventoryToBlock(item: ItemStack, block: Block): void {
  try {
    const itemInv = item.getComponent(ItemComponentTypes.Inventory) as
      | ItemInventoryComponent
      | undefined;
    if (!itemInv || !itemInv.container || itemInv.container.size === 0) return;
    const blockInv = block.getComponent("minecraft:inventory") as
      | BlockInventoryComponent
      | undefined;
    if (!blockInv || !blockInv.container) return;
    for (let i = 0; i < itemInv.container.size; i++) {
      const invItem = itemInv.container.getItem(i);
      if (invItem) {
        blockInv.container.setItem(i, invItem);
      }
    }
  } catch {
    /* ignore - 非容器方块无 inventory 组件 */
  }
}

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
  let data =
    (block && blockStorage.readFromBlock(block)) ||
    blockStorage.deleteData(key);
  if (block) blockStorage.clearBlock(block);
  blockStorage.deleteData(key);

  // 兜底：活塞推后 DP 可能丢失或 key 不匹配，按位置搜容器实体，
  // 但必须验证 machineKey 动态属性匹配才 kill，防止误伤
  if (!data) {
    const fallback = findMatchingContainerEntity(location, dimension, key);
    if (fallback) {
      const items: ItemStack[] = [];
      const container = getEntityContainer(fallback);
      if (container) {
        for (let i = 0; i < container.size; i++) {
          const item = container.getItem(i);
          if (!item) continue;
          container.setItem(i);
          items.push(item);
        }
      }
      removeEntitySafe(fallback);
      for (const item of items) {
        try {
          dimension.spawnItem(item, location);
        } catch {
          /* ignore */
        }
      }
    }
    return;
  }
  const entity = getEntitySafe(data.entityId);
  if (!entity) return;
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
  removeEntitySafe(entity);
  for (const item of items) {
    try {
      dimension.spawnItem(item, location);
    } catch {
      /* ignore */
    }
  }
}

/** 在 pos 附近搜索属于本机器的容器实体（兜底清理用，验证 machineKey） */
function findMatchingContainerEntity(
  pos: Vector3,
  dim: Dimension,
  expectedKey: string,
): Entity | undefined {
  try {
    const entities = dim.getEntities({
      location: pos,
      volume: { x: 3, y: 3, z: 3 },
      type: CONTAINER_ENTITY_TYPE,
    });
    for (const e of entities) {
      const entityKey = e.getDynamicProperty("redstoneplugin:machineKey");
      if (entityKey === expectedKey) return e;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

// ---------- 实体维护 ----------

function resetEntry(entry: BlockStorageEntry, lockHeld: boolean): void {
  const entity = getEntitySafe(entry.data.entityId);
  if (entity) removeEntitySafe(entity);
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
    return;
  }
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
    const neighbor = findMachineBlockNeighbor(loc, dim);
    if (neighbor) {
      const newKey = locationKey(neighbor.location, neighbor.dimension);
      if (blockStorage.moveData(key, newKey)) {
        const e = getEntitySafe(data.entityId);
        if (e) teleportEntitySafe(e, neighbor.location);
      }
      return;
    }
    if (hasMovingBlockNearby(loc, dim)) return;
    resetEntry({ key, data }, false);
    return;
  }
  if (!getEntitySafe(data.entityId)) {
    resetEntry({ key, data }, false);
  }
}

// ---------- 活塞推动 ----------

function handlePistonMove(block: Block, moveDir: Vector3): void {
  const isMachine =
    MACHINE_TYPES.has(block.typeId) ||
    block.typeId === "minecraft:moving_block";
  if (!isMachine) return;
  const currentKey = locationKey(block.location, block.dimension);

  const oldKey = locationKey(sub(block.location, moveDir), block.dimension);
  if (blockStorage.has(oldKey) && !blockStorage.has(currentKey)) {
    moveMachineEntry(block, oldKey, currentKey, block.location);
    return;
  }
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
    teleportEntitySafe(entity, newLocation);
    entity.setDynamicProperty("redstoneplugin:machineKey", newKey);
  }
  blockStorage.moveData(oldKey, newKey);
}

// ---------- 维护循环 ----------

function maintenanceHandleMachine(block: Block): void {
  const key = locationKey(block.location, block.dimension);
  const blockData = blockStorage.readFromBlock(block);
  if (blockData) {
    const regData = blockStorage.getData(key);
    if (!regData || regData.entityId !== blockData.entityId) {
      blockStorage.placeData(key, blockData);
    }
    const entity = getEntitySafe(blockData.entityId);
    if (!entity) {
      scheduleEntityRecheck(key);
      return;
    }
    alignEntityToMachine(entity, block);
    return;
  }
  const regData = blockStorage.getData(key);
  if (regData) blockStorage.writeToBlock(block, regData);
}

function startMaintenanceLoop(): void {
  system.runInterval(() => {
    if (!blockStorage.tryLock()) return;
    try {
      const players = world.getAllPlayers();
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
    handleMachineRemoved(event.block.location, event.block.dimension);
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
