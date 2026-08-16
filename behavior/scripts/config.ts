import { Vector3 } from "@minecraft/server";

export enum AddonBlock {
  PlaceBlock = "redstoneplugin:placeblock",
  CutBlock = "redstoneplugin:cutblock",
}

/** 容器实体 typeId */
export const CONTAINER_ENTITY_TYPE = "redstoneplugin:container_entity";

/** 自定义方块组件 ID */
export const CUSTOM_COMPONENT_ID = "redstoneplugin:controller";

/** 所有机器方块 typeId 集合 */
export const MACHINE_TYPES = new Set<string>([
  AddonBlock.PlaceBlock,
  AddonBlock.CutBlock,
]);

// ---------- 时间常量 ----------

/** 维护循环的执行周期（tick） */
export const MAINTENANCE_INTERVAL = 10;
/** 实体缺失后延迟复查的 tick 数 */
export const ENTITY_RECHECK_DELAY = 4;

// ---------- 搜索范围 ----------

/** place 沿作业方向最多搜索的格子数 */
export const PLACE_SEARCH_RANGE = 64;
/** 维护循环扫描玩家周围方块的半径（10*10 区域） */
export const SCAN_RADIUS = 5;

// ---------- 方块动态属性 ----------

/** 方块动态属性键（权威存储，写在机器方块的 block entity 上） */
export const DP_KEY = "redstoneplugin:machine";

// ---------- 方向映射 ----------

/**
 * 机器工作（up）方向：一律为 facing_direction 的反方向。
 * 水平：方块朝西 -> 作业在东侧；垂直：放在地面（up）-> 向下，天花板（down）-> 向上。
 */
export const FACING_TO_DIR: Record<string, Vector3> = {
  up: { x: 0, y: -1, z: 0 },
  down: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: 0, z: 1 },
  south: { x: 0, y: 0, z: -1 },
  west: { x: 1, y: 0, z: 0 },
  east: { x: -1, y: 0, z: 0 },
};

/** 原生活塞的 facing_direction 是数字状态 */
export const PISTON_FACING_NUM: Record<number, Vector3> = {
  0: { x: 0, y: -1, z: 0 }, // down
  1: { x: 0, y: 1, z: 0 }, // up
  2: { x: 0, y: 0, z: -1 }, // north
  3: { x: 0, y: 0, z: 1 }, // south
  4: { x: -1, y: 0, z: 0 }, // west
  5: { x: 1, y: 0, z: 0 }, // east
};
