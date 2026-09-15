/**
 * Entry point for the daily autonomous content pipeline. Triggered by
 * Windows Task Scheduler (see scripts/register-content-pipeline-task.ps1) —
 * runs independently of any Claude Code session. Runs the real
 * news-radar -> editorial-scoring -> photo-sourcing -> gates -> render
 * pipeline (runAutonomousCycle) and exits.
 *
 * DRY_RUN is hardcoded true: FULL_AUTONOMOUS_READY has not been declared
 * yet (dry runs + chaos tests pending — see MAISCAR_EDITORIAL_DESIGN_SYSTEM.md
 * "Gates de publicação"). Flip to false only after that validation, per
 * explicit user instruction not to re-enable auto-publish before then.
 */
import { runAutonomousCycle } from "../packages/backend/src/jobs/contentPipeline/run";
import { logger } from "../packages/backend/src/lib/logger";

const MAISCAR_ORG_ID = "e20b49b4-2835-4e90-bb41-95b1aab11007";
const MAISCAR_BRAND_ID = "09dc8dec-34e9-4588-97d9-031b820c8a64";
const DRY_RUN = true;

runAutonomousCycle({
  organizationId: MAISCAR_ORG_ID,
  brandId: MAISCAR_BRAND_ID,
  dryRun: DRY_RUN,
})
  .then((result) => {
    logger.info(result, "autonomous cycle finished");
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "autonomous cycle crashed");
    process.exit(1);
  });
