import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach } from 'vitest';

const directories = new Set<string>();
/** Preserve the test's chosen location; clean up only directories this test created. */
export function createTestDirectory(prefix: string): string {
  const directory = mkdtempSync(prefix);
  directories.add(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.clear();
});
