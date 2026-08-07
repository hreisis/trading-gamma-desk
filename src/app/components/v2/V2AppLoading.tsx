/** V2-aligned route loading shell — white background, no terminal chrome. */
export function V2AppLoading() {
  return (
    <div className="v2-app" data-testid="v2-loading">
      <aside className="v2-sidebar" aria-hidden>
        <div className="v2-mark">G</div>
        <nav>
          <span className="v2-loading-nav" />
          <span className="v2-loading-nav" />
          <span className="v2-loading-nav" />
        </nav>
      </aside>
      <div className="v2-main">
        <header className="v2-topbar">
          <div>
            <div className="v2-loading-line v2-loading-line-title" />
            <div className="v2-loading-line v2-loading-line-sub" />
          </div>
        </header>
        <div className="v2-command v2-loading-command" aria-hidden>
          <section className="v2-panel" />
          <section className="v2-panel" />
          <section className="v2-panel" />
        </div>
      </div>
    </div>
  );
}
