import {
  AiError,
  answersDraftTask,
  canonicalSkill,
  DEFAULT_QUESTIONS,
  resumeTailorTask,
  roleQuestions,
  type AiClient,
  type DraftingRequirements,
  type ResumeTailorOutput,
} from "@pathfinder/ai";
import { Prisma, type ScopedDb } from "@pathfinder/db";
import { UserFacingError } from "../errors";
import { ensureExtraction } from "../jobs/extraction";
import { getLogger } from "../logger";
import { getProfile } from "../profile/service";
import { createAiRecorder } from "../usage";
import { factCheckAnswers, factCheckResume, type CheckedResume, type RemovedItem } from "./fact-check";
import { buildProfileFacts, dateRange } from "./facts";
import type { AnswersContent, FactCheckReport, ProfileFact, ResumeContent } from "./types";

export interface GenerateDraftsDeps {
  db: ScopedDb;
  ai: AiClient;
}

export interface GenerateDraftsResult {
  resumeDocumentId: string;
  answersDocumentId: string;
  /** True when at least one answer needs the student to fill it in. */
  needsInput: boolean;
  /** Bullets, answers or skills removed by the fact check. */
  removedCount: number;
}

const MAX_QUESTIONS = 5;
const MAX_BULLETS = 4;

/**
 * The ai.tailor pipeline: requirements → profile facts → tailored resume with cited facts →
 * fact check (code, then model) → one regeneration if anything failed → whatever still fails is
 * dropped and reported → short answers with the same checks → saved as new document versions.
 * Job requirements the profile doesn't cover are listed as gaps, never written into the draft.
 */
export async function generateDrafts({ db, ai }: GenerateDraftsDeps, applicationId: string): Promise<GenerateDraftsResult> {
  const log = getLogger().child({ op: "ai.tailor" });
  const recorder = createAiRecorder(db);

  const application = await db.application.findUnique({ where: { id: applicationId }, include: { jobListing: true } });
  if (!application) throw new UserFacingError("APPLICATION_NOT_FOUND", "We couldn't find that application.", 404);
  const listing = application.jobListing;

  const extraction = await ensureExtraction({ ai, recorder }, listing.id);
  const profile = await getProfile(db);
  if (profile.version === 0) {
    throw new UserFacingError("NO_PROFILE", "Set up your profile first so we have something to draft from.", 409);
  }
  const user = await db.user.findFirst();
  const facts = buildProfileFacts(profile);
  const job = { title: listing.title, company: listing.company };
  const requirements: DraftingRequirements = {
    requiredSkills: extraction.requiredSkills,
    niceToHaveSkills: extraction.niceToHaveSkills,
    responsibilities: extraction.responsibilities,
    otherRequirements: extraction.otherRequirements,
  };

  let checked: CheckedResume;
  let regenerated = false;
  let answersChecked: Awaited<ReturnType<typeof factCheckAnswers>>;
  let questions: string[];
  try {
    const first = await ai.run(resumeTailorTask, { job, requirements, facts }, { recorder });
    checked = await factCheckResume({ ai, recorder }, first, facts);
    if (checked.removedContent > 0) {
      regenerated = true;
      const feedback = checked.removed.map((r) => `"${r.text}": ${r.reason}`);
      const second: ResumeTailorOutput = await ai.run(resumeTailorTask, { job, requirements, facts, feedback }, { recorder });
      checked = await factCheckResume({ ai, recorder }, second, facts);
    }

    questions = [...DEFAULT_QUESTIONS, ...roleQuestions(requirements, job)].slice(0, MAX_QUESTIONS);
    const answers = await ai.run(answersDraftTask, { job, requirements, facts, questions }, { recorder });
    answersChecked = await factCheckAnswers({ ai, recorder }, answers, facts, questions, job);
  } catch (error) {
    if (error instanceof AiError) {
      log.warn({ kind: error.kind }, "drafting failed");
      throw new UserFacingError(
        "AI_UNAVAILABLE",
        "We couldn't draft this application just now. Please try again in a minute.",
        503,
      );
    }
    throw error;
  }

  const resume = assembleResume(profile, facts, checked, {
    name: user?.name ?? "",
    email: user?.email ?? "",
  });
  const answersContent: AnswersContent = {
    answers: answersChecked.answers.map((a, i) => ({ id: `a${i}`, ...a })),
  };

  const removed: RemovedItem[] = [...checked.removed, ...answersChecked.removed];
  const profileSkills = new Set(profile.skills.map((s) => canonicalSkill(s.name).toLowerCase()));
  const gaps = [
    ...extraction.requiredSkills.filter((s) => !profileSkills.has(canonicalSkill(s).toLowerCase())).map(canonicalSkill),
    ...extraction.otherRequirements,
  ].filter((g, i, all) => g.trim() && all.indexOf(g) === i);
  const report: FactCheckReport = {
    checkedAt: new Date().toISOString(),
    regenerated,
    removed,
    gaps,
    passed: checked.passed + answersChecked.passed,
  };

  const nextVersion = async (kind: "RESUME" | "ANSWERS") =>
    ((await db.generatedDocument.aggregate({ where: { applicationId, kind }, _max: { version: true } }))._max.version ?? 0) + 1;
  const [resumeVersion, answersVersion] = [await nextVersion("RESUME"), await nextVersion("ANSWERS")];
  const json = (value: unknown) => value as Prisma.InputJsonValue;

  const [resumeDoc, answersDoc] = await db.$transaction(async (tx) => {
    const r = await tx.generatedDocument.create({
      data: {
        userId: db.userId,
        applicationId,
        kind: "RESUME",
        version: resumeVersion,
        content: json(resume),
        profileVersion: profile.version,
        factCheck: json(report),
      },
    });
    const a = await tx.generatedDocument.create({
      data: {
        userId: db.userId,
        applicationId,
        kind: "ANSWERS",
        version: answersVersion,
        content: json(answersContent),
        profileVersion: profile.version,
        factCheck: json(report),
      },
    });
    await tx.applicationEvent.create({ data: { userId: db.userId, applicationId, type: "DRAFT_READY" } });
    return [r, a] as const;
  });

  const needsInput = answersContent.answers.some((a) => a.needsInput);
  log.info(
    { regenerated, removed: removed.length, passed: report.passed, gaps: gaps.length, needsInput },
    "drafts generated",
  );
  return { resumeDocumentId: resumeDoc.id, answersDocumentId: answersDoc.id, needsInput, removedCount: removed.length };
}

/** Builds the stored resume: structure and header from the profile, wording from the checked draft. */
function assembleResume(
  profile: Awaited<ReturnType<typeof getProfile>>,
  facts: ProfileFact[],
  checked: CheckedResume,
  account: { name: string; email: string },
): ResumeContent {
  const highlightBullets = (parentId: string) =>
    facts
      .filter((f) => f.parentId === parentId)
      .slice(0, MAX_BULLETS)
      .map((f) => ({ text: f.text, factIds: [f.id] }));
  const bulletsFor = (items: CheckedResume["experiences"], sourceId: string) => {
    const drafted = items.find((i) => i.sourceId === sourceId);
    // An item the model skipped (or whose bullets all failed the check) keeps the student's own
    // highlights, verbatim, rather than vanishing.
    const bullets = drafted?.bullets.length ? drafted.bullets : highlightBullets(sourceId);
    return bullets.slice(0, MAX_BULLETS).map((b, k) => ({ id: `${sourceId}:b${k}`, text: b.text, factIds: b.factIds }));
  };

  const projectOrder = [
    ...checked.projects.map((p) => p.sourceId),
    ...profile.projects.map((_, i) => `proj:${i}`).filter((id) => !checked.projects.some((p) => p.sourceId === id)),
  ];

  const ownSummary = profile.summary
    ? { text: profile.summary, factIds: ["summary"] }
    : { text: "", factIds: [] as string[] };
  return {
    header: {
      name: account.name,
      email: account.email,
      phone: profile.phone,
      location: profile.location,
      links: profile.links,
    },
    headline: checked.headline ?? profile.headline,
    summary: checked.summary ?? ownSummary,
    skills: checked.skills.length ? checked.skills : profile.skills.map((s) => s.name),
    experiences: profile.experiences.map((e, i) => ({
      sourceId: `exp:${i}`,
      title: e.title,
      company: e.company,
      location: e.location,
      dates: dateRange(e.startDate, e.endDate, e.current),
      bullets: bulletsFor(checked.experiences, `exp:${i}`),
    })),
    projects: projectOrder.map((sourceId) => {
      const p = profile.projects[Number(sourceId.split(":")[1])]!;
      return {
        sourceId,
        name: p.name,
        role: p.role,
        technologies: p.technologies,
        url: p.url,
        dates: dateRange(p.startDate, p.endDate),
        bullets: bulletsFor(checked.projects, sourceId),
      };
    }),
    education: profile.education.map((ed, i) => ({
      sourceId: `edu:${i}`,
      institution: ed.institution,
      degree: ed.degree,
      field: ed.field,
      dates: dateRange(ed.startDate, ed.endDate),
      grade: ed.grade,
    })),
  };
}
