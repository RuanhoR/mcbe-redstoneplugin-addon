import { system } from "@minecraft/server";
import { KV, KVValue } from "../types";
import { join, dirname, basename, normalize } from "./path";
import { generateUUID } from "./utils";
export enum FileSystemUseKey {
  RootDir = "_fs_rootdir",
}
const CHUNK_SIZE = 32600;
export type FileSystemDir = {
  [key: string]: {
    r: string; // dir: full path (e.g. "/a/b"); file: blob uuid; link: "@" + target path
    c: string; // ISO TIME STRING, created time
    u: string; // ISO TIME STRING, updated time
  };
};
export default class FileSystem {
  constructor(public kv: KV) {
    // 注：这里不能改，为了防止调用环境问题，改了准出问题
    system.run(() => {
      try {
        const raw = this._getValueWithWriteDefault(
          FileSystemUseKey.RootDir,
          "{}",
        ) as string;
        this._rootDir = JSON.parse(raw) as FileSystemDir;
      } catch {
        this._rootDir = {};
      }
    });
  }
  private readonly _protectedPaths: string[] = ["/"];
  private _rootDir: FileSystemDir = {};
  private _getValueWithWriteDefault(key: string, defaultValue: KVValue) {
    let value = this.kv.get(key);
    if (!value) {
      value = defaultValue;
      this.kv.set(key, defaultValue);
    }
    return value;
  }
  private _isDirRef(ref: string): boolean {
    return typeof ref === "string" && ref.startsWith("/");
  }
  private _isLinkRef(ref: string): boolean {
    return typeof ref === "string" && ref.startsWith("@");
  }
  private _validatePath(path: string): string | null {
    if (typeof path !== "string" || path.length === 0) return null;
    const normalized = normalize(path);
    if (!normalized.startsWith("/")) return null;
    if (normalized.length > 1 && normalized.endsWith("/")) {
      return normalized.slice(0, -1);
    }
    return normalized;
  }
  private _isProtectedPath(path: string): boolean {
    return this._protectedPaths.includes(path);
  }
  private _resolvePath(path: string): string | null {
    const validPath = this._validatePath(path);
    if (!validPath) return null;
    const visited = new Set<string>();
    let current = validPath;
    while (true) {
      if (visited.has(current)) return null;
      visited.add(current);
      const name = basename(current);
      if (!name) return current;
      const entry = this._getDir(dirname(current))[name];
      if (entry && this._isLinkRef(entry.r)) {
        const target = this._validatePath(entry.r.slice(1));
        if (!target) return null;
        current = target;
        continue;
      }
      return current;
    }
  }
  private _isFile(path: string): boolean {
    if (path === "/") return false;
    const dir = this._getDir(dirname(path));
    const entry = dir[basename(path)];
    return !!entry && !this._isDirRef(entry.r) && !this._isLinkRef(entry.r);
  }
  private _getDir(dirPath: string): FileSystemDir {
    if (dirPath === "/") return this._rootDir;
    const raw = this.kv.get(`_fsDir:${dirPath}`);
    if (typeof raw !== "string") return {};
    try {
      return JSON.parse(raw) as FileSystemDir;
    } catch {
      return {};
    }
  }
  private _saveDir(dirPath: string, dir: FileSystemDir): void {
    if (dirPath === "/") {
      this._rootDir = dir;
      this.kv.set(FileSystemUseKey.RootDir, JSON.stringify(dir));
    } else {
      this.kv.set(`_fsDir:${dirPath}`, JSON.stringify(dir));
    }
  }
  private _writeBlob(id: string, content: string) {
    const oldMeta = this.kv.get(`_fsBlobMeta:${id}`);
    if (typeof oldMeta === "string") {
      try {
        const parsed = JSON.parse(oldMeta) as { chunks?: number };
        if (typeof parsed.chunks === "number" && parsed.chunks > 0) {
          for (let i = 0; i < parsed.chunks; i++) {
            this.kv.rm(`_fsBlob:${id}:${i}`);
          }
        }
      } catch {}
    }
    this.kv.rm(`_fsBlobMeta:${id}`);
    this.kv.rm(`_fsBlob:${id}`);
    if (content.length <= CHUNK_SIZE) {
      this.kv.set(`_fsBlob:${id}`, content);
    } else {
      const chunks = Math.ceil(content.length / CHUNK_SIZE);
      for (let i = 0; i < chunks; i++) {
        this.kv.set(
          `_fsBlob:${id}:${i}`,
          content.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        );
      }
      this.kv.set(`_fsBlobMeta:${id}`, JSON.stringify({ chunks }));
    }
  }
  private _readBlob(id: string): string {
    const meta = this.kv.get(`_fsBlobMeta:${id}`);
    if (typeof meta === "string") {
      try {
        const parsed = JSON.parse(meta) as { chunks?: number };
        if (typeof parsed.chunks === "number" && parsed.chunks > 0) {
          let result = "";
          for (let i = 0; i < parsed.chunks; i++) {
            const part = this.kv.get(`_fsBlob:${id}:${i}`);
            if (typeof part === "string") result += part;
          }
          return result;
        }
      } catch {}
    }
    const content = this.kv.get(`_fsBlob:${id}`);
    return (content as string) || "";
  }
  private _createBlob(content: string): string {
    const id = generateUUID();
    this._writeBlob(id, content);
    return id;
  }
  private _removeBlob(id: string) {
    const meta = this.kv.get(`_fsBlobMeta:${id}`);
    if (typeof meta === "string") {
      try {
        const parsed = JSON.parse(meta) as { chunks?: number };
        if (typeof parsed.chunks === "number" && parsed.chunks > 0) {
          for (let i = 0; i < parsed.chunks; i++) {
            this.kv.rm(`_fsBlob:${id}:${i}`);
          }
        }
      } catch {}
    }
    this.kv.rm(`_fsBlobMeta:${id}`);
    this.kv.rm(`_fsBlob:${id}`);
  }
  private _createDir(path: string, name: string) {
    this.kv.set(`_fsDir:${join(path, name)}`, JSON.stringify({}));
  }
  private _addItemToDir(parentPath: string, name: string, ref: string) {
    const dir = this._getDir(parentPath);
    const now = new Date().toISOString();
    dir[name] = { r: ref, c: now, u: now };
    this._saveDir(parentPath, dir);
  }
  private _removeDir(dirPath: string) {
    this.kv.rm(`_fsDir:${dirPath}`);
  }
  private _removeDirRecursive(
    dirPath: string,
    visited: Set<string> = new Set(),
  ): void {
    if (visited.has(dirPath)) return;
    visited.add(dirPath);
    const dir = this._getDir(dirPath);
    for (const [, entry] of Object.entries(dir)) {
      if (this._isLinkRef(entry.r)) continue;
      if (this._isDirRef(entry.r)) {
        this._removeDirRecursive(entry.r, visited);
      } else {
        this._removeBlob(entry.r);
      }
    }
    if (!this._isProtectedPath(dirPath)) {
      this._removeDir(dirPath);
    }
  }
  public readFile(path: string): string {
    const resolved = this._resolvePath(path);
    if (!resolved || resolved === "/") return "";
    const dir = dirname(resolved);
    const name = basename(resolved);
    if (!name) return "";
    const dirContent = this._getDir(dir);
    const entry = dirContent[name];
    if (!entry || this._isDirRef(entry.r) || this._isLinkRef(entry.r)) {
      return "";
    }
    return this._readBlob(entry.r);
  }
  public writeFile(path: string, content: string) {
    const resolved = this._resolvePath(path);
    if (!resolved || resolved === "/") return;
    const dir = dirname(resolved);
    const name = basename(resolved);
    if (!name) return;
    const dirContent = this._getDir(dir);
    const now = new Date().toISOString();
    const existing = dirContent[name];
    if (
      existing &&
      (this._isDirRef(existing.r) || this._isLinkRef(existing.r))
    ) {
      return;
    }
    if (existing) {
      this._writeBlob(existing.r, content);
      existing.u = now;
    } else {
      const id = this._createBlob(content);
      dirContent[name] = { r: id, c: now, u: now };
    }
    this._saveDir(dir, dirContent);
  }
  public mkdir(path: string, name: string) {
    const resolved = this._resolvePath(path);
    if (!resolved) return;
    if (typeof name !== "string" || name.length === 0) return;
    if (name === "." || name === ".." || name.includes("/")) return;
    if (this._isFile(resolved)) return;
    const parent = this._getDir(resolved);
    if (parent[name]) return;
    const fullDirPath = this._validatePath(join(resolved, name));
    if (!fullDirPath || this._isProtectedPath(fullDirPath)) return;
    this._createDir(resolved, name);
    this._addItemToDir(resolved, name, fullDirPath);
  }
  public symlink(target: string, path: string, name: string) {
    const validTarget = this._validatePath(target);
    const resolved = this._resolvePath(path);
    if (!validTarget || !resolved) return;
    if (typeof name !== "string" || name.length === 0) return;
    if (name === "." || name === ".." || name.includes("/")) return;
    if (this._isFile(resolved)) return;
    const parent = this._getDir(resolved);
    if (parent[name]) return;
    this._addItemToDir(resolved, name, `@${validTarget}`);
  }
  public readlink(path: string): string {
    const validPath = this._validatePath(path);
    if (!validPath || validPath === "/") return "";
    const entry = this._getDir(dirname(validPath))[basename(validPath)];
    if (!entry || !this._isLinkRef(entry.r)) return "";
    return entry.r.slice(1);
  }
  public readdir(path: string): string[] {
    const resolved = this._resolvePath(path);
    if (!resolved) return [];
    if (this._isFile(resolved)) return [];
    const dir = this._getDir(resolved);
    return Object.keys(dir);
  }
  public rm(path: string) {
    const validPath = this._validatePath(path);
    if (!validPath || this._isProtectedPath(validPath)) return;
    const parentDir = dirname(validPath);
    const name = basename(validPath);
    if (!name) return;
    const dirContent = this._getDir(parentDir);
    const entry = dirContent[name];
    if (!entry) return;
    if (this._isLinkRef(entry.r)) {
      // 只删除链接本身，不删除目标
    } else if (this._isDirRef(entry.r)) {
      this._removeDirRecursive(entry.r);
    } else {
      this._removeBlob(entry.r);
    }
    delete dirContent[name];
    this._saveDir(parentDir, dirContent);
  }
}
