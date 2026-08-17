# RedStone Plugin

Minecraft 基岩版 addon：红石驱动的放置器/挖掘器机器系统。

## 功能

- **放置器** (`redstoneplugin:placeblock`)：红石信号激活时，沿作业方向放置 1 格方块（从容器中消耗）。
- **挖掘器** (`redstoneplugin:cutblock`)：红石信号激活时，挖掘作业方向 1 格方块（扣工具耐久，掉落原版战利品）。

## 机制

- 机器数据存储在方块的 `minecraft:dynamic_properties`（block entity 动态属性），随方块持久化，世界重载不丢失，活塞推动自动跟随。
- 内存 Map 为索引，每 10t 扫描玩家周围 10×10 方块同步。
- 活塞推动（含飞行器高频移动）兼容：moving_block 也走 key 更新，维护循环用 `hasMovingBlockNearby` 防误删。
- 容器实体使用 `minecraft:transformation` scale `[0,0,0]` 隐藏渲染，保留容器/碰撞/交互。

## 合成配方

```
挖掘器:          放置器:
I I I            I I I
P R R            D R R
C C R            S S R
```

- I = 铁锭, P = 木镐, R = 红石, C = 圆石, D = 发射器, S = 石头

## 构建

```bash
pnpm type-check    # 类型检查
pnpm build         # 构建（输出 dist/）
pnpm dev-build     # 开发构建（输出到游戏 development packs）
pnpm dev           # mbler watch 模式
```

## 文件结构

```
behavior/
  blocks/             # 机器方块定义
  entities/           # 容器实体定义
  recipes/            # 合成配方
  scripts/
    config.ts         # 所有常量/枚举/方向映射
    types.ts          # 类型定义
    index.ts          # 入口
    core/
      machine.ts      # 核心逻辑（place/cut/activate/piston/维护/init）
      blockStorage.ts # 方块动态属性权威存储 + 内存索引
      utils.ts        # 向量/方向/实体/位置工具
      container.ts    # 容器/物品操作（消耗/扣耐久/查找）
resources/
  texts/zh_CN.lang    # 中文翻译
```
