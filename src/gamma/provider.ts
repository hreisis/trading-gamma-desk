import type { OptionsChainSnapshot } from "./types";

/**
 * Provider-neutral options chain port. Future MarketData.app / Tradier
 * adapters implement this; M4-1 only ships a fixture reader.
 */
export interface OptionsChainProvider {
  readonly id: string;
  /**
   * Load a chain snapshot for `underlying` as of `sessionDate`.
   * Implementations must not invent realtime quotes in M4-1.
   */
  loadChain(query: {
    readonly underlying: string;
    readonly sessionDate: string;
  }): OptionsChainSnapshot | null;
}
