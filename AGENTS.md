# AGENTS.md

Minecraft Bedrock addon (behavior + resource packs) for redstone-driven block place/cut "machines". Built with [mbler](https://github.com/RuanhoR/mbler). Unit tests live in `tests/` (vitest); no CI.

## Commands (order matters)

- `npm run type-check` → `mcx-tsc` (strict). Fastest correctness check.
- `npm run lint` → ESLint (TS sources + `.mcx` via `@mbler/eslint-plugin-mcx`). `npm run lint:fix` autofixes.
- `npm run test` → vitest (`tests/**/*.spec.ts`). `@minecraft/server`(+`-ui`) are aliased to `tests/mocks/minecraft-server.ts` because the beta runtime packages cannot load under Node; only test pure helpers.
- `npm run build` → release build; **only** this writes `dist/` and `dist.mcaddon`.
- `npm run dev-build` → **does NOT touch `dist/`**. With `outGameOnDev: true` it outputs to the Minecraft game's `development_behavior_packs`/`development_resource_packs`. Don't inspect `dist/` after this; test by reloading the world.
- `npm run dev` → `mbler watch`.

Always run `type-check` then `build` before considering work done.

## Layout / ownership

- `behavior/scripts/index.ts` — entry; only calls `initMachineSystem()`.
- `behavior/scripts/core/machine.ts` — the whole system: redstone activation, place/cut, container-entity lifecycle, piston moves, 10t maintenance loop.
- `behavior/scripts/core/blockStorage.ts` — in-memory `Map` (machine location key → entity id/type) indexing the authoritative block dynamic properties. SAPI is single-threaded run-to-completion; no locking needed.
- `behavior/scripts/core/utils.ts` — `locationKey`/`locationKeyToData` (key format `"${dim.id}(*${x}(*${y}(*${z}"`).
- `behavior/scripts/core/fileSystem.ts`, `worldFileSystem.ts`, `path.ts` — legacy, not imported by any active code. Don't build on them.
- `behavior/blocks/*.json` — block defs (`format_version: "1.26.40"`, `minecraft:placement_direction` trait).
- `behavior/entities/container_entity.json` — the per-machine inventory entity (`minecraft:inventory`, minecart_chest, 27 slots).
- `resources/texts/zh_CN.lang` — translations live here (not under behavior/); block keys are `tile.<id>.name=...`.

## Gotchas

- `@minecraft/server` is a **beta** build (`2.10.0-beta...`); beta APIs like `BlockComponentRedstoneUpdateEvent.firstUpdate` are available.
- `onRedstoneUpdate` also fires on block placement and chunk load (see `minecraft:redstone_consumer` docs). `machine.ts` guards with `firstUpdate` + rising edge (`previousPowerLevel === 0 && powerLevel >= 1`).
- Machine "up"/operating direction is derived from `minecraft:facing_direction`, not `y+1`: horizontal facing → same direction; placed on floor (`up`) → down; ceiling (`down`) → up. See `FACING_TO_DIR` in `machine.ts`.
- Custom block components are v2 style: a named component object in block JSON (`"redstoneplugin:controller": {}`) registered via `system.beforeEvents.startup`. Adding an event handler requires both the block JSON component AND the registration.
- `dimension.spawnEntity` rejects bare custom id strings; pass the generic: `dim.spawnEntity<typeof ID>(ID, pos)`.
- Vanilla piston `facing_direction` state is numeric (0–5); the custom block trait returns a string. `getPistonFacing` handles both.
- Container entity's inventory is read via `EntityInventoryComponent.componentId`; `ContainerSlot` is used for consuming single items (decrement `amount` / `slot.setItem()`).