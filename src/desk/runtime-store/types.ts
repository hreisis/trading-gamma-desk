export interface RuntimeJsonStorePutOptions {
  /** When false (default), put rejects overwriting an existing pathname. */
  readonly allowOverwrite?: boolean;
}

export interface RuntimeJsonStore {
  readonly mode: "filesystem" | "blob";
  /** Human-readable root label for UI source lines (no secrets). */
  readonly rootLabel: string;
  readText(relativePath: string): Promise<string | null>;
  writeText(
    relativePath: string,
    body: string,
    options?: RuntimeJsonStorePutOptions,
  ): Promise<boolean>;
  exists(relativePath: string): Promise<boolean>;
  list(prefix: string): Promise<readonly string[]>;
}
