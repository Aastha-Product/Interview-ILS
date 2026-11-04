import type { ScopedDb } from "@pathfinder/db";
import { UserFacingError } from "../errors";
import {
  emptyProfile,
  preferencesSchema,
  profileInputSchema,
  type PreferencesInput,
  type ProfileInput,
  type ProfileView,
} from "./schema";

type ProfileReader = Pick<ScopedDb, "profile">;

/** Reads the signed-in student's profile. Returns an empty profile with version 0 if none exists. */
export async function getProfile(db: ProfileReader): Promise<ProfileView> {
  const row = await db.profile.findFirst({
    include: {
      experiences: { orderBy: { order: "asc" } },
      projects: { orderBy: { order: "asc" } },
      educations: { orderBy: { order: "asc" } },
      skills: { orderBy: { order: "asc" } },
    },
  });
  if (!row) return { ...emptyProfile(), version: 0, updatedAt: null };
  return {
    headline: row.headline,
    summary: row.summary,
    location: row.location,
    phone: row.phone ?? "",
    links: Array.isArray(row.links) ? (row.links as ProfileInput["links"]) : [],
    experiences: row.experiences.map((e) => ({
      title: e.title,
      company: e.company,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate,
      current: e.current,
      highlights: e.highlights,
    })),
    projects: row.projects.map((p) => ({
      name: p.name,
      role: p.role,
      url: p.url,
      startDate: p.startDate,
      endDate: p.endDate,
      technologies: p.technologies,
      highlights: p.highlights,
    })),
    education: row.educations.map((e) => ({
      institution: e.institution,
      degree: e.degree,
      field: e.field,
      startDate: e.startDate,
      endDate: e.endDate,
      grade: e.grade,
    })),
    skills: row.skills.map((s) => ({ name: s.name, category: s.category })),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Replaces the whole profile in one transaction and bumps `version`.
 * `expectedVersion` is the version the editor loaded; if someone saved since, nothing is written.
 */
export async function saveProfile(
  db: ScopedDb,
  input: unknown,
  expectedVersion: number,
): Promise<ProfileView> {
  const data = profileInputSchema.parse(input);

  await db.$transaction(async (tx) => {
    const existing = await tx.profile.findFirst({ select: { id: true, version: true } });
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== expectedVersion) {
      throw new UserFacingError(
        "PROFILE_CHANGED",
        "Your profile was changed in another tab or window. Reload to see the latest version, then make your edits again.",
        409,
      );
    }

    const fields = {
      headline: data.headline,
      summary: data.summary,
      location: data.location,
      phone: data.phone || null,
      links: data.links,
    };
    let profileId: string;
    if (existing) {
      // The version check is repeated in the WHERE clause so two concurrent saves cannot both win.
      const updated = await tx.profile.updateMany({
        where: { id: existing.id, version: expectedVersion },
        data: { ...fields, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new UserFacingError("PROFILE_CHANGED", "Your profile was just changed elsewhere. Reload and try again.", 409);
      }
      profileId = existing.id;
      await Promise.all([
        tx.experience.deleteMany({ where: { profileId } }),
        tx.project.deleteMany({ where: { profileId } }),
        tx.education.deleteMany({ where: { profileId } }),
        tx.skill.deleteMany({ where: { profileId } }),
      ]);
    } else {
      profileId = (await tx.profile.create({ data: { ...fields, version: 1 } as never })).id;
    }

    const withOrder = <T>(items: T[]) => items.map((item, order) => ({ ...item, order, profileId }));
    // userId is filled in by the scoped client.
    if (data.experiences.length) await tx.experience.createMany({ data: withOrder(data.experiences) as never });
    if (data.projects.length) await tx.project.createMany({ data: withOrder(data.projects) as never });
    if (data.education.length) await tx.education.createMany({ data: withOrder(data.education) as never });
    if (data.skills.length) await tx.skill.createMany({ data: withOrder(data.skills) as never });
    await tx.auditLog.create({ data: { action: "PROFILE_UPDATE" } as never });
  });

  return getProfile(db);
}

export async function getPreferences(db: Pick<ScopedDb, "jobPreference">): Promise<PreferencesInput | null> {
  const row = await db.jobPreference.findFirst();
  if (!row) return null;
  return {
    roles: row.roles,
    locations: row.locations,
    remoteOk: row.remoteOk,
    minSalary: row.minSalary,
    experienceLevel: row.experienceLevel,
  };
}

export async function savePreferences(db: ScopedDb, input: unknown): Promise<PreferencesInput> {
  const data = preferencesSchema.parse(input);
  await db.jobPreference.upsert({
    where: { userId: db.userId },
    create: data as never,
    update: data,
  });
  return data;
}
