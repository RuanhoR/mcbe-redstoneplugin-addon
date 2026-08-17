import {
  BlockPermutation,
  Container,
  ItemComponentTypes,
  ItemDurabilityComponent,
  ItemEnchantableComponent,
} from "@minecraft/server";

/** 从容器中消耗第 slot 格的一格物品 */
export function consumeItem(container: Container, slotIndex: number): void {
  const slot = container.getSlot(slotIndex);
  if (!slot.isValid) return;
  if (slot.amount > 1) {
    slot.amount = slot.amount - 1;
  } else {
    slot.setItem();
  }
}

/** 给工具扣耐久（支持 Unbreaking 附魔），耐久耗尽则销毁该工具 */
export function damageTool(container: Container, slotIndex: number): void {
  const slot = container.getSlot(slotIndex);
  if (!slot.isValid) return;
  const item = slot.getItem();
  if (!item) return;
  const durability = item.getComponent(ItemComponentTypes.Durability) as
    | ItemDurabilityComponent
    | undefined;
  if (!durability || durability.maxDurability <= 0) return;

  // Unbreaking 附魔：getDamageChance 返回 0~1 概率，随机判定是否扣耐久
  let unbreakingLevel = 0;
  try {
    const enchantable = item.getComponent(ItemComponentTypes.Enchantable) as
      | ItemEnchantableComponent
      | undefined;
    if (enchantable) {
      const unb = enchantable.getEnchantment("minecraft:unbreaking");
      if (unb) unbreakingLevel = unb.level;
    }
  } catch {
    /* ignore */
  }
  const chance = durability.getDamageChance(unbreakingLevel);
  if (Math.random() > chance) return; // 未触发耐久损耗

  durability.damage += 1;
  if (durability.damage >= durability.maxDurability) {
    slot.setItem(); // 耐久耗尽 -> 工具消失
  } else {
    slot.setItem(item);
  }
}

/** 该 typeId 是否为可放置方块 */
export function isPlaceableBlock(typeId: string): boolean {
  try {
    BlockPermutation.resolve(typeId);
    return true;
  } catch {
    return false;
  }
}

/** 寻找容器中第一个可放置的方块物品 */
export function findBlockItemSlot(container: Container): number | undefined {
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    if (isPlaceableBlock(item.typeId)) return i;
  }
  return undefined;
}

/** 寻找容器中的镐子/铲子 */
export function findToolSlot(container: Container): number | undefined {
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    const id = item.typeId;
    if (id.includes("_pickaxe") || id.includes("_shovel")) return i;
  }
  return undefined;
}
