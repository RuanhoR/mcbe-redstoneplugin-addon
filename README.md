# RedStone Plugin

Minecraft Bedrock Edition addon: redstone-driven Placer/Cutter machine system.

## Features

- **Placer** (`redstoneplugin:placeblock`): On redstone signal, places 1 block in the operating direction (consumes from container).
- **Cutter** (`redstoneplugin:cutblock`): On redstone signal, mines 1 block in the operating direction (damages tool durability, drops vanilla loot).

## Mechanics

- Machine data stored on block's `minecraft:dynamic_properties` (block entity), persists across world reloads, follows piston pushes automatically.
- In-memory Map as index, syncs by scanning 10x10 area around players every 10 ticks.
- Piston/flying machine compatible: `moving_block` handled in key updates, `hasMovingBlockNearby` prevents false deletion during transit.
- Container entity hidden via `minecraft:transformation` scale `[0,0,0]`, preserves inventory/collision/interaction.

## Crafting Recipes

```
Cutter:          Placer:
I I I            I I I
P R R            D R R
C C R            S S R
```

- I = Iron Ingot, P = Wooden Pickaxe, R = Redstone, C = Cobblestone, D = Dispenser, S = Stone

## Build

```bash
pnpm type-check    # Type check (mcx-tsc)
pnpm build         # Release build (outputs dist/)
pnpm dev-build     # Dev build (outputs to game development packs)
pnpm dev           # mbler watch mode
```

## File Structure

```
behavior/
  blocks/             # Machine block definitions
  entities/           # Container entity definition
  recipes/            # Crafting recipes
  scripts/
    config.ts         # All constants/enums/direction mappings
    types.ts          # Type definitions
    index.ts          # Entry point
    core/
      machine.ts      # Core logic (place/cut/activate/piston/maintenance/init)
      blockStorage.ts # Block dynamic properties authoritative storage + in-memory index
      utils.ts        # Vector/direction/entity/location helpers
      container.ts    # Container/item operations (consume/damage/find)
resources/
  texts/zh_CN.lang    # Chinese translation
```
