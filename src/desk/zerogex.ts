import { z } from "zod";
import { readJson, writeJson, type RuntimeJsonStore } from "./runtime-store";

const level = z.number().finite().positive().nullable();
export const ZeroGexSchema = z.object({
  symbol: z.enum(["SPY", "QQQ"]),
  as_of: z.string().datetime({ offset: true }),
  data_tier: z.literal("free-delayed"),
  market_phase: z.string(),
  spot: z.number().finite().positive(),
  regime: z.string(),
  net_gex_at_spot: z.number().finite(),
  gamma_flip: level, call_wall: level, put_wall: level,
});
export type ZeroGex = z.infer<typeof ZeroGexSchema>;
export function parseZeroGex(value: unknown, symbol: ZeroGex["symbol"]): ZeroGex {
  const data = ZeroGexSchema.parse(value);
  if (data.symbol !== symbol) throw new Error("Wrong symbol");
  return data;
}

/** Fetch on each page request; stored snapshots are failure fallback, never a TTL gate. */
export async function loadZeroGex(symbol: ZeroGex["symbol"], store: RuntimeJsonStore, fetchImpl = fetch) {
  const path = `gamma/zerogex/${symbol}-latest.json`;
  let previous: ZeroGex | null = null;
  try { previous = parseZeroGex(await readJson(store, path), symbol); } catch { /* No valid backup. */ }
  try {
    const response = await fetchImpl("https://zerogex.io/mcp", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_gamma_levels", arguments: { symbol } } }),
    });
    if (!response.ok) throw new Error("Provider unavailable");
    const payload = await response.json();
    if (payload.error || payload.result?.isError) throw new Error("Provider error");
    const data = parseZeroGex(payload.result?.structuredContent, symbol);
    if (previous && Date.parse(data.as_of) < Date.parse(previous.as_of)) return { data: previous, fallback: true };
    try { await writeJson(store, path, data); } catch { /* Display valid response even if persistence fails. */ }
    return { data, fallback: false };
  } catch { return { data: previous, fallback: true }; }
}
