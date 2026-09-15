import { AIProvider, GenerateImageInput, GenerateImageOutput } from "../types";

const BASE_URL = "https://image.pollinations.ai/prompt";

/**
 * Free, keyless image generation via the public Pollinations.ai endpoint —
 * no signup, no rate-limit tier to configure. Lower/less consistent quality
 * than gpt-image-1, so it's the default draft (and current final, until
 * OPENAI billing is set up) image provider — see taskRouter.ts.
 */
export class PollinationsProvider implements AIProvider {
  readonly name = "pollinations";
  readonly capabilities = ["image"] as const as any;

  async generateImage(input: GenerateImageInput): Promise<GenerateImageOutput> {
    const width = input.width ?? 1024;
    const height = input.height ?? 1024;
    // Fixed per-call seed so the returned url keeps serving the same image
    // on repeat GETs instead of regenerating a different one each time.
    const seed = Math.floor(Math.random() * 1_000_000_000);
    // model=flux: markedly more coherent/photoreal than the default "turbo"
    // model — matters most for vehicles, where turbo tends to distort
    // proportions, badges and even the number of wheels.
    const url = `${BASE_URL}/${encodeURIComponent(input.prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux&enhance=true`;

    // Pollinations generates lazily on first GET — fetch once so a failure
    // surfaces here instead of silently producing a broken asset url.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`POLLINATIONS_IMAGE_FAILED: ${res.status} ${await res.text()}`);

    return { url };
  }
}
