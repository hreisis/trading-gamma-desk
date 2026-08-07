export type BreadthStoreErrorCode =
  | "unavailable"
  | "invalid_pointer"
  | "invalid_snapshot"
  | "path_escape"
  | "publish_failed"
  | "read_failed"
  | "write_failed"
  | "identity_conflict";

export class BreadthStoreError extends Error {
  readonly code: BreadthStoreErrorCode;

  constructor(code: BreadthStoreErrorCode, message: string) {
    super(message);
    this.name = "BreadthStoreError";
    this.code = code;
  }
}
