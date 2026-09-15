import { composeSlideImage } from "./src/modules/content/imageComposer";
import fs from "fs/promises";
import path from "path";

const OUT_ROOT = path.join(
  "C:\\Users\\paula\\OneDrive\\Desktop\\Claude\\carrosseis",
);

interface Carousel {
  slug: string;
  backgroundPrompt: string;
  slides: string[];
}

const carousels: Carousel[] = [
  {
    slug: "1-autoridade-tecnica",
    backgroundPrompt:
      "professional car inspector examining a car engine bay with a flashlight, technical inspection, photorealistic, 35mm",
    slides: [
      "Carro bonito por fora pode estar escondendo um problema caro por dentro.",
      "A maioria das pessoas compra pelo olho. E é exatamente assim que caem em carro com problema escondido.",
      "Antes de fechar negócio, a Mais.car confere: documentação e identidade (chassi, motor, vidros gravados), estrutura (longarinas, colunas, painéis), pintura e estética, rodas e pneus, parte elétrica e itens de segurança, iluminação completa, e mecânica (motor, escapamento, direção e suspensão).",
      "Sem achismo. Sem 'parece bom'. Equipamento e olhar técnico em cada avaliação.",
      "Antes de comprar seu próximo carro, chama a Mais.car. A gente avalia, você decide com segurança.",
    ],
  },
  {
    slug: "2-checklist-lead-magnet",
    backgroundPrompt:
      "close-up of hands holding a clipboard with a car inspection checklist, car in background, photorealistic",
    slides: [
      "Vou te dar de graça o checklist que eu uso pra nunca comprar carro com problema escondido.",
      "1. Confronto do documento físico com o digital — bate tudo?",
      "2. Numeração do chassi e do motor: batem com o que está no documento?",
      "3. Diferença de tonalidade na pintura — sinal clássico de reparo escondido.",
      "Comenta 'CHECKLIST' aqui embaixo que eu mando a lista completa no seu direct.",
    ],
  },
  {
    slug: "3-diferenciacao-confianca",
    backgroundPrompt:
      "car consultant shaking hands with a client next to a car in a dealership, trust, photorealistic",
    slides: [
      "Já perdi venda por recusar avaliar um carro pro cliente. E eu faria de novo.",
      "Muita consultoria só confirma o que você quer ouvir. Encontra o carro, faz uma vistoria rápida, aprova e segue em frente.",
      "Aqui na Mais.car, se o carro não é bom, a resposta é não. Mesmo que isso signifique perder a comissão.",
      "Porque confiança não é discurso. É critério aplicado em toda avaliação, sem exceção.",
      "Tá de olho num carro? Manda no direct que a gente avalia antes de você decidir.",
    ],
  },
  {
    slug: "4-case-hrv-clonado",
    backgroundPrompt:
      "close-up of a car chassis identification number plate being inspected, forensic detail, dramatic lighting, photorealistic",
    slides: [
      "Um HR-V 2016, vindo de leilão, parecia um carro normal. Não era.",
      "Fomos avaliar e a primeira coisa que chamou atenção: os vidros estavam raspados — a numeração de identificação gravada tinha sido apagada.",
      "Aí veio o resto: as etiquetas ETA (que confirmam a identidade original do veículo) não existiam. E o chassi também estava raspado.",
      "Vidro raspado + sem etiqueta + chassi raspado não é coincidência. É a assinatura clássica de um carro clonado — um veículo com a identidade de outro.",
      "Comprar um carro clonado não é só perder dinheiro. É correr o risco de perder o carro quando a polícia identificar — e ainda responder por isso.",
      "É exatamente pra pegar isso ANTES de você assinar que a avaliação existe. Chama a Mais.car antes de fechar negócio, principalmente em carro de leilão.",
    ],
  },
  {
    slug: "5-prova-social",
    backgroundPrompt:
      "five star rating icons floating above a happy customer holding car keys next to a car, photorealistic",
    slides: [
      "Aquele feedback que a gente mais gosta de receber.",
      "'Vitor, é um excelente profissional, fez todas as avaliações do carro e nos deixou bastante satisfeito.' — Alberico Costa, Google",
      "'Contratamos a Mais Car para nos ajudar na compra de um veículo e foi uma experiência simplesmente excepcional.' — Ana Cabral, Google",
      "Isso não é sorte. É critério técnico aplicado em cada avaliação, sem exceção.",
      "5 estrelas em 28 avaliações no Google. Quer essa mesma segurança na sua próxima compra? Chama a gente no direct.",
    ],
  },
  {
    slug: "6-noticia-fraude-km",
    backgroundPrompt:
      "close-up of a car odometer dashboard display showing kilometers, dramatic lighting, photorealistic",
    slides: [
      "30% dos carros usados vendidos no Brasil têm a quilometragem adulterada.",
      "Um carro com 120 mil km 'vira' 55 mil km no hodômetro — e o preço sobe milhares de reais em cima de uma mentira.",
      "Não é sorte que a maioria não percebe: quem faz isso sabe exatamente como enganar o comprador comum.",
      "Uma avaliação técnica cruza documentação, desgaste real das peças e histórico — é isso que expõe a farsa.",
      "Antes de fechar negócio, confirma com quem entende. Chama a Mais.car.",
    ],
  },
  {
    slug: "7-noticia-recall-vw",
    backgroundPrompt:
      "row of cars in a service center for recall repair, mechanics working, photorealistic",
    slides: [
      "A Volkswagen chamou 150 mil carros de volta à fábrica por falha no freio de mão.",
      "Se você comprou um carro usado recentemente, sabia que ele pode estar com um recall pendente e nem imaginar?",
      "Recall não aparece no anúncio. Muita gente compra o carro com uma falha de segurança ativa sem saber.",
      "Checar recalls pendentes é parte de qualquer avaliação séria antes da compra.",
      "Quer ter certeza que o carro que você tá de olho não tem pendência nenhuma? Chama a Mais.car antes de comprar.",
    ],
  },
];

async function fetchBackground(prompt: string): Promise<Buffer> {
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1350&seed=${seed}&nologo=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Background fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await fs.mkdir(OUT_ROOT, { recursive: true });
  const manifest: Record<string, string[]> = {};

  for (const carousel of carousels) {
    console.log(`\n=== ${carousel.slug} ===`);
    const dir = path.join(OUT_ROOT, carousel.slug);
    await fs.mkdir(dir, { recursive: true });

    console.log("  fetching background...");
    const background = await fetchBackground(carousel.backgroundPrompt);

    const files: string[] = [];
    for (let i = 0; i < carousel.slides.length; i++) {
      const slideText = carousel.slides[i];
      const composed = await composeSlideImage({ background, slideText, width: 1080, height: 1350 });
      const destName = `slide-${i + 1}.png`;
      const destPath = path.join(dir, destName);
      await fs.copyFile(composed.filePath, destPath);
      files.push(destName);
      console.log(`  slide ${i + 1}/${carousel.slides.length} -> ${destPath}`);
    }
    manifest[carousel.slug] = files;
  }

  await fs.writeFile(path.join(OUT_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  console.log("\nDone. Manifest written to", path.join(OUT_ROOT, "manifest.json"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
