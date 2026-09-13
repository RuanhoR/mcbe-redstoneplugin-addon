// @ts-check
import { defineConfig } from "@mbler/mfd";

export default defineConfig({
  title: { zh: "红石插件", en: "Redstone Plugin" },
  mcVersion: { min: "1.26.40", max: "1.26.40" },
  description: {
    zh: `# 红石插件 (Redstone Plugin)

Minecraft 基岩版红石向模组：**红石驱动的放置器 / 切割机**系统。

## 仓库

GitHub: [mcbe-redstoneplugin-addon](https://github.com/RuanhoR/mcbe-redstoneplugin-addon)

## 安装

选择与你的 Minecraft 版本匹配的 \`dist.mcaddon\` 下载后导入游戏即可。
`,
    en: `# Redstone Plugin

A redstone-focused Minecraft Bedrock Edition addon: a **redstone-driven Placer / Cutter** machine system.

## Repository

GitHub: [mcbe-redstoneplugin-addon](https://github.com/RuanhoR/mcbe-redstoneplugin-addon)

## Install

Download the \`dist.mcaddon\` matching your Minecraft version and import it into the game.
`,
  },
  entryAddonManifest: "/assets/manifest.addon.json",
  entryDistAddon: "/assets/dist.mcaddon",
  base: "/redstone-plugin/",
  distEntry: "./dist-page",
  addon: "./dist.mcaddon",
  port: 9527,
});
