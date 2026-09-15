import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, fetchContentList } from "../../lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const STATUS_LABEL: Record<string, string> = {
  IDEA: "Ideia",
  DRAFT: "Rascunho",
  GENERATED: "Gerado",
  REVIEW: "Aguardando revisão",
  APPROVED: "Aprovado",
  SCHEDULED: "Agendado",
  PUBLISHED: "Publicado",
  ARCHIVED: "Arquivado",
};

async function approveAction(formData: FormData) {
  "use server";
  await updateStatus(formData, "APPROVED");
}

async function archiveAction(formData: FormData) {
  "use server";
  await updateStatus(formData, "ARCHIVED");
}

async function updateStatus(formData: FormData, status: string) {
  const contentId = formData.get("contentId") as string;
  const organizationId = formData.get("organizationId") as string;
  const cookieHeader = cookies().toString();

  await fetch(`${API_URL}/api/content/${contentId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "X-Organization-Id": organizationId,
    },
    body: JSON.stringify({ status }),
  });

  revalidatePath("/content");
}

export default async function ContentReviewPage({
  searchParams,
}: {
  searchParams: { org?: string; brand?: string };
}) {
  const cookieHeader = headers().get("cookie") ?? "";
  const session = await getSession(cookieHeader);

  if (!session) {
    redirect("/login");
  }

  const organizationId = searchParams.org ?? session!.organizations[0]?.id;
  if (!organizationId) {
    return (
      <main className="max-w-lg mx-auto py-24 px-6 text-center text-slate-400">
        Sua conta não tem nenhuma organização ainda.
      </main>
    );
  }

  const content = await fetchContentList(cookieHeader, organizationId, searchParams.brand);

  return (
    <main className="max-w-6xl mx-auto py-12 px-6">
      <div className="flex items-baseline justify-between mb-8">
        <h1 className="text-2xl font-semibold">Conteúdo gerado</h1>
        <p className="text-slate-500 text-sm">{session!.user.name} · {session!.organizations.find((o) => o.id === organizationId)?.name}</p>
      </div>

      {content.length === 0 ? (
        <p className="text-slate-400">Nenhum conteúdo ainda. Gere ideias e imagens pela API.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {content.map((item) => {
            const image = item.assets.find((a) => a.type === "image");
            return (
              <div key={item.id} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800 flex flex-col">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image.url} alt={item.title ?? item.hook ?? "conteúdo"} className="w-full aspect-[4/5] object-cover" />
                ) : (
                  <div className="w-full aspect-[4/5] bg-slate-800 flex items-center justify-center text-slate-600 text-sm">
                    sem imagem
                  </div>
                )}
                <div className="p-4 flex-1 flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-wide text-amber-500 font-medium">
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                  {item.title && <p className="font-medium text-sm">{item.title}</p>}
                  {item.hook && <p className="text-slate-400 text-sm line-clamp-3">{item.hook}</p>}
                  <div className="mt-auto flex gap-2 pt-3">
                    <form action={approveAction}>
                      <input type="hidden" name="contentId" value={item.id} />
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <button
                        type="submit"
                        disabled={item.status === "APPROVED"}
                        className="text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-medium rounded-md px-3 py-1.5 transition-colors"
                      >
                        Aprovar
                      </button>
                    </form>
                    <form action={archiveAction}>
                      <input type="hidden" name="contentId" value={item.id} />
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <button
                        type="submit"
                        disabled={item.status === "ARCHIVED"}
                        className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded-md px-3 py-1.5 transition-colors"
                      >
                        Rejeitar
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
