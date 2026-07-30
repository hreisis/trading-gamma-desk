import { GITHUB_REPO_URL } from "@/desk/public-demo";

export function DeskChrome({ children }: { children: React.ReactNode }) {
  return (
    <main className="desk">
      <header className="desk-brand">
        <div className="desk-brand-row">
          <p className="desk-product">GammaDesk</p>
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
