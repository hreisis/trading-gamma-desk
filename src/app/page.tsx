import { ALL_SYMBOLS, ASSET_REGISTRY, CONTRACT_SCHEMA_VERSION } from "@/contracts";

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>GammaDesk</h1>
      <p style={{ color: "var(--muted)", marginTop: 4 }}>
        Driver &rarr; Catalyst &rarr; Structure &rarr; Confirmation &rarr; Updated View
      </p>

      <p style={{ marginTop: 32 }}>
        Contracts <code>v{CONTRACT_SCHEMA_VERSION}</code> are in place. The macro
        desk surface arrives with M1-9; nothing here renders market data yet.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Milestone 1 asset registry</h2>
      <ul style={{ color: "var(--muted)", paddingLeft: 18 }}>
        {ALL_SYMBOLS.map((symbol) => {
          const asset = ASSET_REGISTRY[symbol];
          return (
            <li key={symbol}>
              {asset.label} &middot; <code>{asset.unit}</code> &middot;{" "}
              {asset.isProxy ? `via ${asset.instrument}` : asset.instrument}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
