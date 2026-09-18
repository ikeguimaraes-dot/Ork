import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const nativeRequire = createRequire(import.meta.url);
export function loadTs(path, overrides = {}, cache = new Map()) {
  const file = resolve(path);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const require = spec => {
    if (spec in overrides) return overrides[spec];
    if (spec === "server-only") return {};
    let target = spec.startsWith("@/") ? resolve("src", spec.slice(2)) : spec.startsWith("@ork/") ? resolve("lib/ork", spec.slice(6)) : spec.startsWith(".") ? resolve(dirname(file), spec) : null;
    if (!target) return nativeRequire(spec);
    if (!existsSync(target)) target += ".ts";
    return loadTs(target, overrides, cache);
  };
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(outputText, { exports, require, console, process, crypto: globalThis.crypto, Date, Intl, Buffer, setTimeout, clearTimeout }, { filename: file });
  return exports;
}
