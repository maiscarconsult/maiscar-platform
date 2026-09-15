import { fetchAnalyticsOverview } from "../../lib/api";

/**
 * MVP dashboard: reads `token` and `org` from the query string so the module
 * is demonstrable without a full session/cookie implementation yet. Replace
 * with a proper auth session (NextAuth or a custom cookie-based session)
 * before shipping — see TODO(auth-session) below.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { token?: string; org?: string; brand?: string };
}) {
  const { token, org, brand } = searchParams;

  if (!token || !org) {
    return (
      <main className="max-w-lg mx-auto py-24 px-6 text-center">
        <p className="text-slate-400">
          Faça login via <code>/api/auth/login</code> e acesse{" "}
          <code>/dashboard?token=...&org=...</code>.
        </p>
      </main>
    );
  }

  // TODO(auth-session): replace query-string token with an httpOnly session
  // cookie set at login time.
  const overview = await fetchAnalyticsOverview(token, org, brand);

  return (
    <main className="max-w-5xl mx-auto py-12 px-6">
      <h1 className="text-2xl font-semibold mb-8">Performance</h1>

      {overview.insufficientData ? (
        <p className="text-slate-400">
          Dados insuficientes para gerar analytics ainda. Publique conteúdo e registre
          performance para começar a ver insights aqui.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-4 gap-4 mb-12">
            <Metric label="Views" value={overview.totals!.views.toLocaleString("pt-BR")} />
            <Metric label="Leads" value={overview.totals!.leads.toLocaleString("pt-BR")} />
            <Metric label="Vendas" value={overview.totals!.sales.toLocaleString("pt-BR")} />
            <Metric
              label="Receita"
              value={overview.totals!.revenue.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            />
          </section>

          <h2 className="text-xl font-medium mb-4">Top conteúdos (Revenue Content Score)</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="py-2">Conteúdo</th>
                <th>Hook</th>
                <th className="text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {overview.topContent.map((c) => (
                <tr key={c.contentId} className="border-b border-slate-900">
                  <td className="py-2">{c.title ?? "(sem título)"}</td>
                  <td className="text-slate-400">{c.hook ?? "—"}</td>
                  <td className="text-right font-mono">{c.score.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900 rounded-lg p-4">
      <p className="text-slate-400 text-sm">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
