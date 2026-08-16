import {
  Block,
  Dimension,
  Entity,
  EntityInventoryComponent,
  Vector3,
  world,
  World,
} from "@minecraft/server";
import { KV, KVValue } from "../types";
import {
  CONTAINER_ENTITY_TYPE,
  FACING_TO_DIR,
  MACHINE_TYPES,
  PISTON_FACING_NUM,
} from "../config";

// ---------- UUID ----------

export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------- KV ----------

export function toKV(source: Entity | World): KV {
  return {
    get(key: string): KVValue | undefined {
      return source.getDynamicProperty(key) as KVValue | undefined;
    },
    set(key: string, value: KVValue): void {
      source.setDynamicProperty(key, value as string | number | boolean);
    },
    rm(key: string): void {
      source.setDynamicProperty(key, undefined);
    },
  };
}

// ---------- 位置 ----------

export function locationKey(location: Vector3, dim: Dimension) {
  return `${dim.id}(*${location.x}(*${location.y}(*${location.z}`;
}
export function locationKeyToData(key: string): [Vector3, Dimension] {
  const spiltd = key.split("(*").map((v, i) => {
    if (i == 0) return v;
    return parseInt(v);
  });
  return [
    {
      x: spiltd[1] as number,
      y: spiltd[2] as number,
      z: spiltd[3] as number,
    },
    world.getDimension(spiltd[0] as string),
  ];
}

// ---------- 向量 ----------

export function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function neg(a: Vector3): Vector3 {
  return { x: -a.x, y: -a.y, z: -a.z };
}

// ---------- 方向解析 ----------

export function getFacingDirection(block: Block): string {
  const state = block.permutation.getState("minecraft:facing_direction") as
    | string
    | number
    | undefined;
  return state === undefined ? "" : String(state);
}

/** 机器工作（up）方向 */
export function getOperatingDirection(block: Block): Vector3 {
  return FACING_TO_DIR[getFacingDirection(block)] ?? { x: 0, y: -1, z: 0 };
}

export function getPistonFacing(block: Block): Vector3 | undefined {
  const state = block.permutation.getState("facing_direction");
  if (typeof state === "number") return PISTON_FACING_NUM[state];
  if (typeof state === "string") return FACING_TO_DIR[state];
  return undefined;
}

// ---------- 实体 ----------

export function getEntitySafe(id: string): Entity | undefined {
  try {
    return world.getEntity(id);
  } catch {
    return undefined;
  }
}

export function removeEntitySafe(entity: Entity): void {
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

export function teleportEntitySafe(entity: Entity, loc: Vector3): void {
  try {
    entity.teleport(loc);
  } catch {
    /* ignore */
  }
}

export function getEntityContainer(entity: Entity) {
  const inv = entity.getComponent(EntityInventoryComponent.componentId) as
    | EntityInventoryComponent
    | undefined;
  return inv?.container;
}

export function spawnContainerEntity(machine: Block): Entity | undefined {
  const dim = machine.dimension;
  const center = machine.location;
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

export function alignEntityToMachine(entity: Entity, machine: Block): void {
  const target = machine.location;
  const cur = entity.location;
  if (
    Math.abs(cur.x - target.x) < 0.5 &&
    Math.abs(cur.y - target.y) < 0.5 &&
    Math.abs(cur.z - target.z) < 0.5
  ) {
    return;
  }
  teleportEntitySafe(entity, target);
}

// ---------- 方块搜索 ----------

/** 在 pos 的 6 个相邻格寻找机器方块（活塞推动后 key 还没更新时的兜底） */
export function findMachineBlockNeighbor(
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
export function hasMovingBlockNearby(pos: Vector3, dim: Dimension): boolean {
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
