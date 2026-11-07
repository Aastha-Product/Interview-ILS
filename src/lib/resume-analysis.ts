import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { resumeReviewSchema, type ResumeReview } from "@/lib/ai/tasks/review-resume";
import { importedProfileSchema, type ImportedProfile } from "@/lib/profile-import";
import { prisma } from "@/lib/prisma";

// Pathfinder: the student's resume analyses. Each holds what was read from the resume and the
// review, never the resume's text; the owner scope keeps every student's to themselves.

export type ResumeAnalysisView = {
  id: string;
  fileName: string;
  createdAt: Date;
  profile: ImportedProfile;
  review: ResumeReview;
  profileFilled: boolean;
};

export async function saveResumeAnalysis(data: { fileName: string; profile: ImportedProfile; review: ResumeReview; readWith: string; profileFilled: boolean }): Promise<string> {
  const { id } = await prisma.resumeAnalysis.create({
    data: {
      fileName: data.fileName,
      profile: data.profile as Prisma.InputJsonValue,
      review: data.review as Prisma.InputJsonValue,
      readWith: data.readWith,
      profileFilled: data.profileFilled,
    },
    select: { id: true },
  });
  return id;
}

/** One analysis, or null when it isn't the student's or no longer exists. */
export async function getResumeAnalysis(id: string): Promise<ResumeAnalysisView | null> {
  const row = await prisma.resumeAnalysis.findUnique({ where: { id } });
  if (!row) return null;
  const profile = importedProfileSchema.safeParse(row.profile);
  const review = resumeReviewSchema.safeParse(row.review);
  if (!profile.success || !review.success) return null;
  return { id: row.id, fileName: row.fileName, createdAt: row.createdAt, profile: profile.data, review: review.data, profileFilled: row.profileFilled };
}

/** The student's analyses, newest first, for the list under the upload. */
export async function listResumeAnalyses(): Promise<{ id: string; fileName: string; createdAt: Date }[]> {
  return prisma.resumeAnalysis.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, fileName: true, createdAt: true }, take: 50 });
}

export async function deleteResumeAnalysis(id: string): Promise<boolean> {
  const { count } = await prisma.resumeAnalysis.deleteMany({ where: { id } });
  return count > 0;
}

/** Whether the profile has nothing in it yet, so the first resume can fill it without asking. */
export async function profileIsEmpty(): Promise<boolean> {
  const [fields, skills, roles, projects, education] = await Promise.all([
    prisma.profileField.count(),
    prisma.skill.count(),
    prisma.experience.count(),
    prisma.project.count(),
    prisma.education.count(),
  ]);
  return fields + skills + roles + projects + education === 0;
}
