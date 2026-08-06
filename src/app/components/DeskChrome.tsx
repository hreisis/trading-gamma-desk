import { GITHUB_REPO_URL } from "@/desk/public-demo";

export function DeskChrome({
  children,
  demoMode,
}: {
  children: React.ReactNode;
  demoMode?: boolean;
}) {
  return (
    <div className="terminal-shell">
      <header className="terminal-header">
        <div className="terminal-header-main">
          <div className="terminal-brand">
            <p className="terminal-product">GammaDesk</p>
            <p className="terminal-tagline">Gamma · Structure · Signals</p>
          </div>
          <a
            className="terminal-repo"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </header>
      <main className="terminal-main terminal-main-workspace">{children}</main>
      <footer className="terminal-footer">
        <span>Read-only · confidence uncalibrated</span>
        <span className="terminal-footer-sep">·</span>
        <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
          {GITHUB_REPO_URL.replace(/^https:\/\//, "")}
        </a>
        {!demoMode ? (
          <>
            <span className="terminal-footer-sep">·</span>
            <a href="/demo">Synthetic demo</a>
          </>
        ) : null}
      </footer>
    </div>
  );
}
