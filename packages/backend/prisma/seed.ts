import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/auth.service";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("ChangeMe123!");

  const user = await prisma.user.create({
    data: {
      email: "founder@example.com",
      name: "Founder",
      passwordHash,
      memberships: {
        create: {
          role: "OWNER",
          organization: { create: { name: "Demo Org", slug: "demo-org" } },
        },
      },
    },
    include: { memberships: true },
  });

  const brand = await prisma.brand.create({
    data: {
      organizationId: user.memberships[0].organizationId,
      name: "Demo Brand",
      positioning: "Curso online para iniciantes em marketing digital",
      tone: "direto, motivacional",
    },
  });

  await prisma.product.create({
    data: {
      brandId: brand.id,
      name: "Curso Marketing Zero ao Um",
      price: 497,
      benefits: ["Do zero à primeira venda em 30 dias"],
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Seed complete. Login: founder@example.com / ChangeMe123! (org: ${brand.organizationId})`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
