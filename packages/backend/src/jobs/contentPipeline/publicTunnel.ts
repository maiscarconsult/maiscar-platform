import fs from "node:fs";
import { logger } from "../../lib/logger";

/**
 * Composited carousel slides are written to local disk and served by this
 * backend's own /generated static route — but Instagram's servers need a
 * publicly reachable image_url to build a media container, and this app
 * runs on a home machine with no fixed public domain.
 *
 * Tried a temporary tunnel first (localtunnel, then a Cloudflare quick
 * tunnel) — both served the file correctly to a normal fetch, but Instagram
 * rejected every attempt with "Only photo or video can be accepted as media
 * type" / "Não foi possível obter a mídia deste URI". Confirmed by testing
 * the exact same file through a real public host (catbox.moe) with the
 * exact same call: Meta actively blocks known ephemeral-tunnel domains
 * (trycloudflare.com, loca.lt, ...) from being used as media sources — this
 * is a Meta-side security policy, not a bug in the tunnel or this code.
 *
 * catbox.moe accepts anonymous multipart uploads (no account/API key) and
 * returns a permanent public URL — that's what Instagram actually needs.
 */
export async function uploadForPublicAccess(
  localFilePath: string,
  opts: { mimeType?: string; fileName?: string } = {},
): Promise<string> {
  const buf = fs.readFileSync(localFilePath);
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", new Blob([buf], { type: opts.mimeType ?? "image/png" }), opts.fileName ?? "slide.png");

  const res = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
  const text = (await res.text()).trim();
  if (!res.ok || !text.startsWith("http")) {
    throw new Error(`PUBLIC_IMAGE_UPLOAD_FAILED: ${res.status} ${text}`);
  }
  logger.info({ url: text }, "content pipeline: uploaded slide for public access");
  return text;
}
