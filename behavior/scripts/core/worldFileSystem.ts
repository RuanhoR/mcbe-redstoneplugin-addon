import { world } from "@minecraft/server";
import FileSystem from "./fileSystem";
import { toKV } from "./utils";

export const worldFileSystem = new FileSystem(toKV(world));
