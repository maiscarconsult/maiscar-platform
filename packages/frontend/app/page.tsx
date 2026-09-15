import Link from "next/link";

export default function HomePage() {
  return (
    <main className="max-w-xl mx-auto py-24 px-6 text-center">
      <h1 className="text-3xl font-semibold mb-4">Content Intelligence Platform</h1>
      <p className="text-slate-400 mb-8">
        MVP em construção — módulos de Auth, Brand, Product, Competitor, Content e
        Analytics já funcionam via API.
      </p>
      <div className="flex gap-4 justify-center">
        <Link
          href="/login"
          className="bg-amber-600 hover:bg-amber-500 text-slate-950 font-medium rounded-lg px-4 py-2 transition-colors"
        >
          Entrar
        </Link>
        <Link
          href="/content"
          className="bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg px-4 py-2 transition-colors"
        >
          Revisar conteúdo
        </Link>
      </div>
    </main>
  );
}
