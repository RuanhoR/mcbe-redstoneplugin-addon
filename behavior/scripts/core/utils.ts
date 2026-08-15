import { Dimension, Entity, Vector3, world, World } from "@minecraft/server";
import { KV, KVValue } from "../types";

export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
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
