export function DeskChrome({ children }: { children: React.ReactNode }) {
  return (
    <main className="desk">
      <header className="desk-brand">
        <p className="desk-product">GammaDesk</p>
        <p className="desk-chain">
          Driver → Catalyst → Structure → Confirmation → Updated View
        </p>
      </header>
      {children}
    </main>
  );
}
