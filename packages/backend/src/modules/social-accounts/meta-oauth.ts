import fs from "node:fs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

/**
 * Instagram API with Instagram Login (no Facebook Page required — chosen
 * specifically because this org's Business Manager verification failed,
 * which blocks the classic Page-based Instagram Graph API flow).
 * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 */
const GRAPH_VERSION = env.META_GRAPH_API_VERSION;
// instagram_business_manage_insights added 2026-09-10 — needed to read
// reach/views/likes/comments/shares/saves/watch-time via the Insights API
// for already-published media. Publishing alone (the two scopes below)
// never granted insights read access; this requires the user to
// re-authorize via the OAuth connect flow (existing tokens don't gain the
// new scope retroactively).
const INSTAGRAM_SCOPES = "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights";

interface OAuthState {
  organizationId: string;
  brandId: string;
}

export function buildAuthorizationUrl(state: OAuthState): string {
  if (!env.META_APP_ID) throw new Error("META_APP_ID_NOT_CONFIGURED");

  const signedState = jwt.sign(state, env.JWT_SECRET, { expiresIn: "10m" });

  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: env.META_REDIRECT_URI,
    scope: INSTAGRAM_SCOPES,
    response_type: "code",
    state: signedState,
  });

  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export function verifyState(state: string): OAuthState {
  return jwt.verify(state, env.JWT_SECRET) as unknown as OAuthState;
}

interface ShortLivedTokenResponse {
  access_token: string;
  user_id: string;
}

interface LongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface InstagramProfile {
  user_id: string;
  username: string;
}

/** Step 1: authorization code -> short-lived token (expires in ~1h). */
export async function exchangeCodeForShortLivedToken(
  code: string,
): Promise<ShortLivedTokenResponse> {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new Error("META_APP_CREDENTIALS_NOT_CONFIGURED");
  }

  const body = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: env.META_REDIRECT_URI,
    code,
  });

  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as ShortLivedTokenResponse & { error_message?: string };
  if (!res.ok) {
    throw new Error(`INSTAGRAM_TOKEN_EXCHANGE_FAILED: ${data.error_message ?? res.statusText}`);
  }
  return data;
}

/** Step 2: short-lived -> long-lived token (valid ~60 days, refreshable). */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<LongLivedTokenResponse> {
  if (!env.META_APP_SECRET) throw new Error("META_APP_SECRET_NOT_CONFIGURED");

  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: env.META_APP_SECRET,
    access_token: shortLivedToken,
  });

  const res = await fetch(`https://graph.instagram.com/access_token?${params.toString()}`);
  const data = (await res.json()) as LongLivedTokenResponse & { error?: { message: string } };
  if (!res.ok) {
    throw new Error(`INSTAGRAM_LONG_LIVED_EXCHANGE_FAILED: ${data.error?.message ?? res.statusText}`);
  }
  return data;
}

export async function fetchInstagramProfile(accessToken: string): Promise<InstagramProfile> {
  const params = new URLSearchParams({
    fields: "user_id,username",
    access_token: accessToken,
  });
  const res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/me?${params.toString()}`);
  const data = (await res.json()) as InstagramProfile & { error?: { message: string } };
  if (!res.ok) {
    throw new Error(`INSTAGRAM_PROFILE_FETCH_FAILED: ${data.error?.message ?? res.statusText}`);
  }
  return data;
}

/**
 * Content Publishing API: create a media container, then publish it.
 * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
 */
async function waitForContainerReady(
  containerId: string,
  accessToken: string,
  { timeoutMs = 60_000, intervalMs = 2_000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const params = new URLSearchParams({ fields: "status_code", access_token: accessToken });
    const res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${containerId}?${params.toString()}`);
    const data = (await res.json()) as { status_code?: string; error?: { message: string } };
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") {
      throw new Error(`INSTAGRAM_MEDIA_CONTAINER_ERROR: ${data.error?.message ?? "container processing failed"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("INSTAGRAM_MEDIA_CONTAINER_TIMEOUT");
}

export async function publishImageToInstagram(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  caption: string,
): Promise<{ mediaId: string }> {
  const createParams = new URLSearchParams({
    image_url: imageUrl,
    caption,
    access_token: accessToken,
  });

  const createRes = await fetch(
    `https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/media`,
    { method: "POST", body: createParams },
  );
  const createData = (await createRes.json()) as { id?: string; error?: { message: string } };
  if (!createRes.ok || !createData.id) {
    throw new Error(`INSTAGRAM_MEDIA_CREATE_FAILED: ${createData.error?.message ?? createRes.statusText}`);
  }

  // The container isn't publishable until Instagram finishes downloading and
  // processing the image — publish_media_publish can otherwise fail with
  // "Media ID is not available" even though media/create succeeded.
  await waitForContainerReady(createData.id, accessToken);

  const publishParams = new URLSearchParams({
    creation_id: createData.id,
    access_token: accessToken,
  });
  const publishRes = await fetch(
    `https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/media_publish`,
    { method: "POST", body: publishParams },
  );
  const publishData = (await publishRes.json()) as { id?: string; error?: { message: string } };
  if (!publishRes.ok || !publishData.id) {
    throw new Error(`INSTAGRAM_MEDIA_PUBLISH_FAILED: ${publishData.error?.message ?? publishRes.statusText}`);
  }

  return { mediaId: publishData.id };
}

/**
 * Carousel: each image becomes an `is_carousel_item` container, then a
 * parent container of type CAROUSEL references them all as `children`.
 * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing#carousels
 */
export async function publishCarouselToInstagram(
  igUserId: string,
  accessToken: string,
  imageUrls: string[],
  caption: string,
): Promise<{ mediaId: string }> {
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error("INSTAGRAM_CAROUSEL_INVALID_ITEM_COUNT");
  }

  const childIds: string[] = [];
  for (const imageUrl of imageUrls) {
    const params = new URLSearchParams({
      image_url: imageUrl,
      is_carousel_item: "true",
      access_token: accessToken,
    });
    const res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/media`, {
      method: "POST",
      body: params,
    });
    const data = (await res.json()) as { id?: string; error?: { message: string } };
    if (!res.ok || !data.id) {
      throw new Error(`INSTAGRAM_CAROUSEL_ITEM_CREATE_FAILED: ${data.error?.message ?? res.statusText}`);
    }
    await waitForContainerReady(data.id, accessToken);
    childIds.push(data.id);
  }

  const parentParams = new URLSearchParams({
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
    access_token: accessToken,
  });
  const parentRes = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/media`, {
    method: "POST",
    body: parentParams,
  });
  const parentData = (await parentRes.json()) as { id?: string; error?: { message: string } };
  if (!parentRes.ok || !parentData.id) {
    throw new Error(`INSTAGRAM_CAROUSEL_CREATE_FAILED: ${parentData.error?.message ?? parentRes.statusText}`);
  }
  await waitForContainerReady(parentData.id, accessToken);

  const publishParams = new URLSearchParams({ creation_id: parentData.id, access_token: accessToken });
  const publishRes = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/media_publish`, {
    method: "POST",
    body: publishParams,
  });
  const publishData = (await publishRes.json()) as { id?: string; error?: { message: string } };
  if (!publishRes.ok || !publishData.id) {
    throw new Error(`INSTAGRAM_CAROUSEL_PUBLISH_FAILED: ${publishData.error?.message ?? publishRes.statusText}`);
  }

  return { mediaId: publishData.id };
}

/**
 * Reels: single video container, media_type=REELS + video_url (the audio
 * track must already be muxed INTO the video file — see reelRenderer.ts —
 * the Content Publishing API has no separate "attach music" step for
 * API-published Reels, unlike the in-app manual flow for PHOTO/CAROUSEL).
 * Video containers take longer to process than images, so this uses a
 * longer poll timeout than publishImageToInstagram's default.
 * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing#reels
 *
 * NOT WIRED UP to the daily scheduler or any PublishingJob adapter yet
 * (2026-09-10) — written and ready, but this project has not actually
 * called it against the live API. FULL_AUTONOMOUS_REEL stays NOT READY
 * until: a real licensed track exists in audio-library/, reelRenderer's
 * output has been manually reviewed, and the user explicitly turns this on.
 */
export async function publishReelToInstagram(
  igUserId: string,
  accessToken: string,
  videoUrl: string,
  caption: string,
): Promise<{ mediaId: string }> {
  const createParams = new URLSearchParams({
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    access_token: accessToken,
  });

  const createRes = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/media`, {
    method: "POST",
    body: createParams,
  });
  const createData = (await createRes.json()) as { id?: string; error?: { message: string } };
  if (!createRes.ok || !createData.id) {
    throw new Error(`INSTAGRAM_REEL_CREATE_FAILED: ${createData.error?.message ?? createRes.statusText}`);
  }

  await waitForContainerReady(createData.id, accessToken, { timeoutMs: 5 * 60_000, intervalMs: 3_000 });

  const publishParams = new URLSearchParams({ creation_id: createData.id, access_token: accessToken });
  const publishRes = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/media_publish`, {
    method: "POST",
    body: publishParams,
  });
  const publishData = (await publishRes.json()) as { id?: string; error?: { message: string } };
  if (!publishRes.ok || !publishData.id) {
    throw new Error(`INSTAGRAM_REEL_PUBLISH_FAILED: ${publishData.error?.message ?? publishRes.statusText}`);
  }

  return { mediaId: publishData.id };
}

/**
 * publishReelFromLocalFile — R2_INDEPENDENT_PUBLISH (2026-09-12): the
 * account has no public host that reliably serves video (catbox.moe proved
 * unreliable, and standing up an R2/S3 bucket requires a Cloudflare login
 * this session can't perform). Meta's Resumable Upload API sidesteps a
 * public `video_url` entirely — the local MP4 is pushed directly to
 * rupload.facebook.com in one chunk, so no video ever needs to be publicly
 * reachable at all. `thumb_offset` (ms into the video) is used for the
 * cover instead of a public `cover_url`, for the same reason.
 * NOT previously tested against the live API on this org's Instagram-Login
 * (graph.instagram.com) setup — this app uses instagram_business_content_publish
 * without a connected Facebook Page, and Meta's resumable-upload docs are
 * written for the classic Page-based Graph API, so whether
 * upload_type=resumable is honored here is exactly what a real call
 * verifies, not something to assume.
 * https://developers.facebook.com/docs/graph-api/guides/upload
 */
export async function publishReelFromLocalFile(
  igUserId: string,
  accessToken: string,
  localFilePath: string,
  caption: string,
  thumbOffsetMs = 0,
): Promise<{ mediaId: string; permalink?: string }> {
  const fileSize = fs.statSync(localFilePath).size;

  const createParams = new URLSearchParams({
    media_type: "REELS",
    upload_type: "resumable",
    caption,
    thumb_offset: String(thumbOffsetMs),
    access_token: accessToken,
  });
  const createRes = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/media`, {
    method: "POST",
    body: createParams,
  });
  const createData = (await createRes.json()) as { id?: string; uri?: string; error?: { message: string; error_subcode?: number } };
  if (!createRes.ok || !createData.id) {
    throw new Error(`INSTAGRAM_RESUMABLE_CONTAINER_FAILED: ${createData.error?.message ?? createRes.statusText}`);
  }
  const containerId = createData.id;
  // Some API versions return the rupload session URI directly on container
  // creation (`uri`); when they don't, it's addressed by container id at
  // the standard ig-api-upload path.
  const uploadUri = createData.uri ?? `https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}/${containerId}`;

  let offset = 0;
  const fileBuffer = fs.readFileSync(localFilePath);
  const MAX_RETRIES = 1;
  for (let attempt = 0; attempt <= MAX_RETRIES && offset < fileSize; attempt++) {
    const uploadRes = await fetch(uploadUri, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        offset: String(offset),
        file_size: String(fileSize),
        "Content-Type": "application/octet-stream",
      },
      body: fileBuffer.subarray(offset),
    });
    const uploadData = (await uploadRes.json().catch(() => ({}))) as { success?: boolean; start_offset?: string; end_offset?: string; h?: string; debug_info?: { message: string } };
    if (!uploadRes.ok) {
      if (attempt < MAX_RETRIES) continue; // one retry on a transient failure, per spec
      throw new Error(`INSTAGRAM_RESUMABLE_UPLOAD_FAILED: HTTP ${uploadRes.status} ${uploadData.debug_info?.message ?? ""}`);
    }
    // A resumed/partial upload reports where it actually got to — resume
    // from there instead of restarting the whole file.
    const reportedEnd = uploadData.end_offset !== undefined ? Number(uploadData.end_offset) : fileSize;
    offset = Number.isFinite(reportedEnd) ? reportedEnd : fileSize;
  }
  if (offset < fileSize) {
    throw new Error(`INSTAGRAM_RESUMABLE_UPLOAD_INCOMPLETE: uploaded ${offset} of ${fileSize} bytes`);
  }

  await waitForContainerReady(containerId, accessToken, { timeoutMs: 5 * 60_000, intervalMs: 3_000 });

  const publishParams = new URLSearchParams({ creation_id: containerId, access_token: accessToken });
  const publishRes = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/${igUserId}/media_publish`, {
    method: "POST",
    body: publishParams,
  });
  const publishData = (await publishRes.json()) as { id?: string; error?: { message: string } };
  if (!publishRes.ok || !publishData.id) {
    throw new Error(`INSTAGRAM_RESUMABLE_PUBLISH_FAILED: ${publishData.error?.message ?? publishRes.statusText}`);
  }

  const permalinkRes = await fetch(
    `https://graph.instagram.com/${GRAPH_VERSION}/${publishData.id}?fields=permalink&access_token=${accessToken}`,
  );
  const permalinkData = (await permalinkRes.json().catch(() => ({}))) as { permalink?: string };

  return { mediaId: publishData.id, permalink: permalinkData.permalink };
}
