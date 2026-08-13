import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { assertSafeStoreRelativePath } from "./path-safety";
import type { RuntimeJsonStore, RuntimeJsonStorePutOptions } from "./types";

export interface FilesystemRuntimeJsonStoreOptions {
  readonly dataRoot: string;
}

function absolutePath(root: string, relativePath: string): string {
  assertSafeStoreRelativePath(relativePath);
  const absolute = join(root, relativePath);
  const normalizedRoot = join(root);
  if (
    !absolute.startsWith(normalizedRoot + "/") &&
    absolute !== normalizedRoot
  ) {
    throw new Error(`resolved path escapes store root: ${relativePath}`);
  }
  return absolute;
}

export function createFilesystemRuntimeJsonStore(
  options: FilesystemRuntimeJsonStoreOptions,
): RuntimeJsonStore {
  const root = options.dataRoot;

  return {
    mode: "filesystem",
    rootLabel: root,

    async readText(relativePath) {
      const path = absolutePath(root, relativePath);
      if (!existsSync(path)) return null;
      return readFileSync(path, "utf8");
    },

    async writeText(relativePath, body, putOptions?: RuntimeJsonStorePutOptions) {
      const path = absolutePath(root, relativePath);
      if (existsSync(path) && putOptions?.allowOverwrite !== true) {
        return false;
      }
      writeJsonAtomic(path, JSON.parse(body) as unknown);
      return true;
    },

    async exists(relativePath) {
      return existsSync(absolutePath(root, relativePath));
    },

    async list(prefix) {
      assertSafeStoreRelativePath(prefix);
      const dir = join(root, prefix);
      if (!existsSync(dir)) return [];
      const entries = readdirSync(dir, { withFileTypes: true });
      const paths: string[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const relative = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
        assertSafeStoreRelativePath(relative);
        paths.push(relative);
      }
      return paths.sort();
    },
  };
}
