import { GITHUB_REPO_URL, PUBLIC_DEMO_SESSION } from "@/desk/public-demo";
import { resolveCurrentMarketSessionDate } from "@/ai-study/session";

function navHref(path: string, demoMode?: boolean): string {
  if (!demoMode) return path;
  if (path === "/") return "/demo";
  return `/demo${path}`;
}

export function DeskChrome({
  children,
  activeNav,
  demoMode,
}: {
  children: React.ReactNode;
  activeNav?: "macro" | "decide" | "market" | "ai-study";
  demoMode?: boolean;
}) {
  const decideDate = demoMode
    ? PUBLIC_DEMO_SESSION
    : resolveCurrentMarketSessionDate();

  return (
    <main className="desk">
      <header className="desk-brand">
        <div className="desk-brand-row">
          <p className="desk-product">GammaDesk</p>
          <nav className="desk-nav" aria-label="Primary">
            <a
              className={activeNav === "macro" ? "desk-nav-link is-active" : "desk-nav-link"}
              href={navHref("/", demoMode)}
              aria-current={activeNav === "macro" ? "page" : undefined}
            >
              Macro Desk
            </a>
            <a
              className={activeNav === "decide" ? "desk-nav-link is-active" : "desk-nav-link"}
              href={`/decide?date=${decideDate}`}
              aria-current={activeNav === "decide" ? "page" : undefined}
            >
              Decide
            </a>
            <a
              className={activeNav === "market" ? "desk-nav-link is-active" : "desk-nav-link"}
              href={navHref("/market", demoMode)}
              aria-current={activeNav === "market" ? "page" : undefined}
            >
              Market
            </a>
            <a
              className={
                activeNav === "ai-study" ? "desk-nav-link is-active" : "desk-nav-link"
              }
              href={navHref("/ai-study", demoMode)}
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
        {!demoMode ? (
          <>
            <span className="desk-footer-sep">·</span>
            <a href="/demo">Synthetic demo</a>
          </>
        ) : null}
      </footer>
    </main>
  );
}
