import { describe, expect, it } from "vitest";
import {
  add,
  generateUUID,
  locationKey,
  neg,
  sub,
} from "../behavior/scripts/core/utils";

// pure helpers only: functions touching world/blocks run inside Minecraft
describe("core/utils", () => {
  it("adds and subtracts vectors", () => {
    expect(add({ x: 1, y: 2, z: 3 }, { x: 10, y: 20, z: 30 })).toEqual({
      x: 11,
      y: 22,
      z: 33,
    });
    expect(sub({ x: 10, y: 20, z: 30 }, { x: 1, y: 2, z: 3 })).toEqual({
      x: 9,
      y: 18,
      z: 27,
    });
  });

  it("negates vectors", () => {
    expect(neg({ x: 1, y: -2, z: 3 })).toEqual({ x: -1, y: 2, z: -3 });
  });

  it("builds stable location keys per dimension", () => {
    const key = locationKey(
      { x: 1, y: 2, z: 3 },
      { id: "minecraft:overworld" } as never,
    );
    expect(key).toBe("minecraft:overworld(*1(*2(*3");
    expect(
      locationKey({ x: 1, y: 2, z: 3 }, { id: "minecraft:the_end" } as never),
    ).not.toBe(key);
  });

  it("generates unique ids", () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(seen.size).toBe(100);
  });
});
