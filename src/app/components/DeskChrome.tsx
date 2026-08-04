import { GITHUB_REPO_URL, PUBLIC_DEMO_SESSION } from "@/desk/public-demo";

export function DeskChrome({
  children,
  activeNav,
}: {
  children: React.ReactNode;
  activeNav?: "macro" | "decide" | "market" | "ai-study";
}) {
  return (
    <main className="desk">
      <header className="desk-brand">
        <div className="desk-brand-row">
          <p className="desk-product">GammaDesk</p>
          <nav className="desk-nav" aria-label="Primary">
            <a
              className={activeNav === "macro" ? "desk-nav-link is-active" : "desk-nav-link"}
              href="/"
              aria-current={activeNav === "macro" ? "page" : undefined}
            >
              Macro Desk
            </a>
            <a
              className={activeNav === "decide" ? "desk-nav-link is-active" : "desk-nav-link"}
              href={`/decide?date=${PUBLIC_DEMO_SESSION}`}
              aria-current={activeNav === "decide" ? "page" : undefined}
            >
              Decide
            </a>
            <a
              className={activeNav === "market" ? "desk-nav-link is-active" : "desk-nav-link"}
              href="/market"
              aria-current={activeNav === "market" ? "page" : undefined}
            >
              Market
            </a>
            <a
              className={
                activeNav === "ai-study" ? "desk-nav-link is-active" : "desk-nav-link"
              }
              href="/ai-study"
              aria-current={activeNav === "ai-study" ? "page" : undefined}
            >
              AI Study
            </a>
          </nav>
          <a
            className="desk-repo"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
        <p className="desk-chain">
          Driver → Catalyst → Structure → Confirmation → Updated View
        </p>
      </header>
      {children}
      <footer className="desk-footer">
        <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
          {GITHUB_REPO_URL.replace(/^https:\/\//, "")}
        </a>
        <span className="desk-footer-sep">·</span>
        <span>Read-only Macro Desk · confidence uncalibrated</span>
      </footer>
    </main>
  );
}
