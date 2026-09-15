-- AlterTable
ALTER TABLE "CompetitorContent" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE INDEX "CompetitorContent_competitorId_externalId_idx" ON "CompetitorContent"("competitorId", "externalId");
