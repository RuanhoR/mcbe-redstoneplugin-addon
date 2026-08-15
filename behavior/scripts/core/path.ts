// path.ts
const SEP = "/";
const DELIMITER = ":";

function isPathSeparator(code: number): boolean {
  return code === 47; // '/'
}

function normalizeString(path: string, allowAboveRoot: boolean): string {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;

  for (let i = 0; i <= path.length; ++i) {
    let code: number;
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (isPathSeparator(path.charCodeAt(lastSlash + 1))) {
      break;
    } else {
      code = 47;
    }

    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== 46 ||
          res.charCodeAt(res.length - 2) !== 46
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.length - lastSegmentLength - 1;
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(SEP);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${SEP}..` : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) {
          res += `${SEP}${path.slice(lastSlash + 1, i)}`;
        } else {
          res = path.slice(lastSlash + 1, i);
        }
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function formatExt(ext: string): string {
  return ext ? `${ext[0] === "." ? "" : "."}${ext}` : "";
}

interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

function _format(pathObject: ParsedPath): string {
  const dir = pathObject.dir || pathObject.root;
  const base =
    pathObject.base || `${pathObject.name || ""}${formatExt(pathObject.ext)}`;
  if (!dir) {
    return base;
  }
  return dir === pathObject.root ? `${dir}${base}` : `${dir}${SEP}${base}`;
}

/**
 * 规范化路径，解析 `.` 和 `..`
 */
export function normalize(path: string): string {
  if (typeof path !== "string" || path.length === 0) return ".";

  const isAbsolute = path.charCodeAt(0) === 47;
  const trailingSeparator = path.charCodeAt(path.length - 1) === 47;

  path = normalizeString(path, !isAbsolute);

  if (path.length === 0) {
    if (isAbsolute) return "/";
    return trailingSeparator ? "./" : ".";
  }
  if (trailingSeparator) path += "/";

  return isAbsolute ? `/${path}` : path;
}

/**
 * 解析路径为绝对路径
 */
export function resolve(...args: string[]): string {
  if (
    args.length === 0 ||
    (args.length === 1 && (args[0] === "" || args[0] === "."))
  ) {
    return "/";
  }

  let resolvedPath = "";
  let resolvedAbsolute = false;

  for (let i = args.length - 1; i >= 0 && !resolvedAbsolute; --i) {
    const path = args[i];
    if (typeof path !== "string" || path.length === 0) continue;

    resolvedPath = `${path}/${resolvedPath}`;
    resolvedAbsolute = path.charCodeAt(0) === 47;
  }

  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute);

  if (resolvedAbsolute) return `/${resolvedPath}`;
  return resolvedPath.length > 0 ? resolvedPath : ".";
}

/**
 * 拼接路径
 */
export function join(...args: string[]): string {
  if (args.length === 0) return ".";

  const parts: string[] = [];
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    if (typeof arg === "string" && arg.length > 0) {
      parts.push(arg);
    }
  }

  if (parts.length === 0) return ".";
  return normalize(parts.join(SEP));
}

/**
 * 获取路径的目录名
 */
export function dirname(path: string): string {
  if (typeof path !== "string" || path.length === 0) return ".";
  const hasRoot = path.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;

  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }

  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return path.slice(0, end);
}

/**
 * 获取路径的文件名（包含扩展名）
 */
export function basename(path: string, suffix?: string): string {
  if (typeof path !== "string" || path.length === 0) return "";

  let start = 0;
  let end = -1;
  let matchedSlash = true;

  if (
    suffix !== undefined &&
    suffix.length > 0 &&
    suffix.length <= path.length
  ) {
    if (suffix === path) return "";
    let extIdx = suffix.length - 1;
    let firstNonSlashEnd = -1;

    for (let i = path.length - 1; i >= 0; --i) {
      const code = path.charCodeAt(i);
      if (code === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          if (code === suffix.charCodeAt(extIdx)) {
            if (--extIdx === -1) {
              end = i;
            }
          } else {
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }

    if (start === end) end = firstNonSlashEnd;
    else if (end === -1) end = path.length;
    return path.slice(start, end);
  }

  for (let i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }

  if (end === -1) return "";
  return path.slice(start, end);
}

/**
 * 获取文件扩展名
 */
export function extname(path: string): string {
  if (typeof path !== "string" || path.length === 0) return "";

  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;

  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return "";
  }
  return path.slice(startDot, end);
}

/**
 * 解析路径为对象
 */
export function parse(path: string): ParsedPath {
  const ret: ParsedPath = { root: "", dir: "", base: "", ext: "", name: "" };
  if (typeof path !== "string" || path.length === 0) return ret;

  const isAbsolute = path.charCodeAt(0) === 47;
  let start: number;

  if (isAbsolute) {
    ret.root = "/";
    start = 1;
  } else {
    start = 0;
  }

  let startDot = -1;
  let startPart = start;
  let end = -1;
  let matchedSlash = true;
  let i = path.length - 1;
  let preDotState = 0;

  for (; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }

  if (end !== -1) {
    const s = startPart === 0 && isAbsolute ? 1 : startPart;
    if (
      startDot === -1 ||
      preDotState === 0 ||
      (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
    ) {
      ret.base = ret.name = path.slice(s, end);
    } else {
      ret.name = path.slice(s, startDot);
      ret.base = path.slice(s, end);
      ret.ext = path.slice(startDot, end);
    }
  }

  if (startPart > 0) {
    ret.dir = path.slice(0, startPart - 1);
  } else if (isAbsolute) {
    ret.dir = "/";
  }

  return ret;
}

/**
 * 计算从 from 到 to 的相对路径
 */
export function relative(from: string, to: string): string {
  if (from === to) return "";

  from = resolve(from);
  to = resolve(to);

  if (from === to) return "";

  const fromStart = 1;
  const fromEnd = from.length;
  const fromLen = fromEnd - fromStart;
  const toStart = 1;
  const toLen = to.length - toStart;

  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;

  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i);
    if (fromCode !== to.charCodeAt(toStart + i)) break;
    else if (fromCode === 47) lastCommonSep = i;
  }

  if (i === length) {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === 47) {
        return to.slice(toStart + i + 1);
      }
      if (i === 0) {
        return to.slice(toStart + i);
      }
    } else if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === 47) {
        lastCommonSep = i;
      } else if (i === 0) {
        lastCommonSep = 0;
      }
    }
  }

  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === 47) {
      out += out.length === 0 ? ".." : "/..";
    }
  }

  return `${out}${to.slice(toStart + lastCommonSep)}`;
}

/**
 * 格式化路径对象为路径字符串
 */
export function format(pathObject: ParsedPath): string {
  return _format(pathObject);
}

export const sep = SEP;
export const delimiter = DELIMITER;

// 常用组合导出
export default {
  normalize,
  resolve,
  join,
  dirname,
  basename,
  extname,
  parse,
  relative,
  format,
  sep,
  delimiter,
};
