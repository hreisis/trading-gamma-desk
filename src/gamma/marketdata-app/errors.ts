export class MarketDataAppNormalizeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MarketDataAppNormalizeError";
    this.code = code;
  }
}
