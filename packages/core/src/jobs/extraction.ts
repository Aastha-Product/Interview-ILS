import {
  AiError,
  canonicalSkill,
  jobExtractTask,
  jobRequirementsSchema,
  type AiClient,
  type AiRecorder,
  type JobRequirements,
} from "@pathfinder/ai";
import { getPrisma } from "@pathfinder/db/raw";
import { UserFacingError } from "../errors";
import { getLogger } from "../logger";

export type ExtractionView = JobRequirements & { id: string; modelUsed: string; updatedAt: Date };

export interface ExtractionDeps {
  ai: AiClient;
  /** Records the model call against the student who triggered it. */
  recorder?: AiRecorder;
}

/**
 * The structured requirements of a posting. Extracted once per posting (and prompt version) and
 * shared by every student who looks at it, so ten students applying to one job cost one call.
 */
export async function ensureExtraction(deps: ExtractionDeps, jobListingId: string): Promise<ExtractionView> {
  const prisma = getPrisma();
  const listing = await prisma.jobListing.findUnique({
    where: { id: jobListingId },
    include: { extraction: true },
  });
  if (!listing) throw new UserFacingError("JOB_NOT_FOUND", "We couldn't find that job. It may have been removed.", 404);

  const cached = listing.extraction;
  if (cached && cached.promptVersion === jobExtractTask.promptVersion) {
    const parsed = jobRequirementsSchema.safeParse(cached.requirements);
    if (parsed.success) {
      return { ...parsed.data, id: cached.id, modelUsed: cached.modelUsed, updatedAt: cached.updatedAt };
    }
  }

  let requirements: JobRequirements;
  try {
    requirements = await deps.ai.run(
      jobExtractTask,
      {
        title: listing.title,
        company: listing.company,
        location: listing.location,
        description: listing.description,
      },
      { recorder: deps.recorder },
    );
  } catch (error) {
    if (error instanceof AiError) {
      getLogger().warn({ kind: error.kind, op: "job.extract" }, "job extraction failed");
      throw new UserFacingError(
        "AI_UNAVAILABLE",
        "We couldn't read this job's requirements just now. Please try again in a minute.",
        503,
      );
    }
    throw error;
  }

  const skills = [
    ...new Set([...requirements.requiredSkills, ...requirements.niceToHaveSkills].map(canonicalSkill).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const data = {
    requirements,
    skills,
    seniority: requirements.seniority,
    modelUsed: deps.ai.providerName,
    promptVersion: jobExtractTask.promptVersion,
  };
  const saved = await prisma.jobExtraction.upsert({
    where: { jobListingId },
    create: { jobListingId, ...data },
    update: data,
  });
  return { ...requirements, id: saved.id, modelUsed: saved.modelUsed, updatedAt: saved.updatedAt };
}
