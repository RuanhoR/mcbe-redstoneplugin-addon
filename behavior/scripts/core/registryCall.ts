import { packCall } from "@mbler/mcx";
import {
  BlockLootDataValue,
  EntityLootDataValue,
  registryBlockData,
  registryEntityData,
} from "@ojang/vanilla-lootdata";
import { AddonBlock } from "../config";
type RegistryOption = [
  "entity" | "block",
  Record<string, EntityLootDataValue> | Record<string, BlockLootDataValue>,
];

packCall.createEvent("redstoneplugin:registryData", (data) => {
  const resolveData = data as RegistryOption;
  if (resolveData[0] !== "block" && resolveData[0] !== "entity")
    throw new TypeError(
      "[RedStonePlugin Registry Event]: Registry Use Object Cannot be null",
    );
  if (resolveData[0] == "block") {
    registryBlockData(resolveData[1]);
  } else {
    registryEntityData(resolveData[1]);
  }
  return true;
});
packCall.runEvent(
  "redstoneplugin:registryData",
  [
    "block",
    {
      [AddonBlock.PlaceBlock]: {
        item: [AddonBlock.PlaceBlock, { min: 1, max: 1 }, 1],
      },
      [AddonBlock.CutBlock]: {
        item: [AddonBlock.CutBlock, { min: 1, max: 1 }, 1],
      },
    },
  ] satisfies RegistryOption,
  -1,
);
