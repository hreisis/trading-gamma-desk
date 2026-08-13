import type { RuntimeJsonStore, RuntimeJsonStorePutOptions } from "./types";

export async function readJson(
  store: RuntimeJsonStore,
  relativePath: string,
): Promise<unknown | null> {
  const raw = await store.readText(relativePath);
  if (raw === null) return null;
  return JSON.parse(raw) as unknown;
}

export async function writeJson(
  store: RuntimeJsonStore,
  relativePath: string,
  value: unknown,
  options?: RuntimeJsonStorePutOptions,
): Promise<boolean> {
  const body = JSON.stringify(value, null, 2) + "\n";
  return await store.writeText(relativePath, body, options);
}
