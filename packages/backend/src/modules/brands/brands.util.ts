import { prisma } from "../../lib/prisma";

/**
 * Guards against cross-tenant access: throws NOT_FOUND if the brand doesn't
 * belong to the organization scoping the current request. This is the core
 * of "isolamento de dados por organização" (section 29) applied at the
 * data-access layer, not just at the route layer.
 */
export async function assertBrandInOrg(brandId: string, organizationId: string) {
  const brand = await prisma.brand.findFirst({ where: { id: brandId, organizationId } });
  if (!brand) throw new Error("NOT_FOUND");
  return brand;
}
