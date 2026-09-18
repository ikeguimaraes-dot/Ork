export default function Loading() {
  return <div role="status" aria-label="Carregando dados financeiros" style={{ display: "grid", gap: 24, maxWidth: 1440, margin: "0 auto" }}><span className="sr-only">Carregando dados financeiros…</span><div className="ork-skeleton" style={{ height: 70, maxWidth: 560 }} /><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 16 }}>{[1, 2, 3, 4].map((id) => <div key={id} className="ork-skeleton" style={{ height: 185 }} />)}</div><div className="ork-skeleton" style={{ height: 350 }} /></div>;
}
