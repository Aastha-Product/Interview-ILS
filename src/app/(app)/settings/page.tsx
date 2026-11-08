import type { Metadata } from "next";
import { headers } from "next/headers";

import { loadAiConfig, loadAiSettingsView } from "@/lib/ai/config";
import { analysesLeftToday, analysesPerDay } from "@/lib/ai/daily-limit";
import { verifySession } from "@/lib/auth/session";
import { listResumeAnalyses } from "@/lib/resume-analysis";
import { managedMode } from "@/lib/managed";
import { toolsEnabled } from "@/lib/tools";
import { signInMode } from "@/lib/auth/google-sign-in";
import { jobSearchView, loadJobSearchConfig } from "@/lib/job-search/config";
import { COUNTRIES } from "@/lib/job-search/countries";
import { loadSearch } from "@/lib/posting-searches";
import { providerOption } from "@/lib/ai/provider-options";
import { lastNightlyBackup } from "@/lib/backup-schedule";
import { backupsDir } from "@/lib/backups";
import { exportFileName } from "@/lib/data-export";
import { formatShortDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { googleConnection } from "@/lib/google/account";
import { loadGoogleClientConfig, redirectUri } from "@/lib/google/oauth";
import { lastKnownTimeZone, userTimeZone } from "@/lib/time-zone";
import { appVersion } from "@/lib/version";
import { prisma, systemPrisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { scoringProblem } from "@/lib/scoring";
import { loadScoringConfig, scoringView } from "@/lib/scoring/config";
import { loadSettings } from "@/lib/settings-data";
import { availableUpdate } from "@/lib/update-check";
import { USAGE_PING_HOST, usagePingChoice } from "@/lib/usage-ping";

import { AgentSection } from "./agent-section";
import { AiBehaviour } from "./ai-behaviour";
import { AiProviderSection } from "./ai-provider-section";
import { DataSection } from "./data-section";
import { DocumentsSection } from "./documents-section";
import { GoogleSection } from "./google-section";
import { GoogleNotice } from "./google-notice";
import { JobSearchSection } from "./job-search-section";
import { ScoringSection } from "./scoring-section";
import { AboutSection, type AboutFacts, type UsagePingView } from "./about-section";
import { managedSettingsSections, SETTINGS_SECTIONS, settingsSectionFromParam, STUDENT_SETTINGS_SECTIONS } from "./sections";
import { SettingsScreen } from "./settings-screen";
import { AccountSection, HelpSection, PlanSection, PrivacySection } from "./student-sections";

export const metadata: Metadata = { title: "Settings" };

/** Settings (PRD §6.8); the section is in `?section=` (E10-1). */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams;
  // Pathfinder: without the job-search tools, students get a short Settings with nothing technical.
  if (!toolsEnabled()) return <StudentSettings param={params.section} />;
  // Pathfinder, managed mode: no AI provider, job source, scoring or OAuth client to set up.
  const managed = managedMode();
  const sections = managed ? managedSettingsSections((await loadGoogleClientConfig()).client !== null) : SETTINGS_SECTIONS;
  const section = settingsSectionFromParam(params.section, sections);
  const description = managed ? MANAGED_DESCRIPTION : undefined;
  // Pathfinder, managed mode: the student's own sections, the same as where the tools are off.
  if (isStudentSection(section)) {
    return (
      <SettingsScreen section={section} sections={sections} description={description}>
        {await studentSection(section)}
      </SettingsScreen>
    );
  }
  const settings = await loadSettings();
  const aiBehaviour = <AiBehaviour initial={{ creativity: settings.creativity, strict: settings.strict, showDiff: settings.showDiff }} />;

  return (
    <SettingsScreen section={section} sections={sections} description={description}>
      {section === "ai" ? (
        <>
          <AiProviderSection initial={await loadAiSettingsView()} />
          {aiBehaviour}
        </>
      ) : section === "jobs" ? (
        <JobSearchSection initial={jobSearchView(await loadJobSearchConfig())} />
      ) : section === "scoring" ? (
        <ScoringSection initial={scoringView(await loadScoringConfig())} />
      ) : section === "agent" ? (
        <AgentSection
          initial={{
            enabled: settings.agentEnabled,
            // With no search of its own yet, it starts from the last one in Find jobs.
            query: settings.agentQuery.keywords.trim() ? settings.agentQuery : ((await loadSearch())?.query ?? settings.agentQuery),
            hour: settings.agentHour,
            minScore: settings.agentMinScore,
            maxScores: settings.agentMaxScores,
            maxDrafts: settings.agentMaxDrafts,
            autoDraft: settings.agentAutoDraft,
          }}
          source={(await loadJobSearchConfig()).source}
          scoring={await scoringReadiness()}
          countries={COUNTRIES}
          timeZone={await lastKnownTimeZone()}
        />
      ) : section === "google" ? (
        <>
          <GoogleNotice outcome={typeof params.google === "string" ? params.google : null} />
          <GoogleSection
            connection={await googleView()}
            client={await googleClientView()}
            browserTimeZone={(await userTimeZone()) ?? null}
            redirectUri={redirectUri(await requestOrigin())}
            managed={managed}
            initial={{
              gmailRead: settings.gmailRead,
              gmailScope: settings.gmailScope,
              gmailInterval: settings.gmailInterval,
              calendarAvailability: settings.calendarAvailability,
              calendarEvents: settings.calendarEvents,
              calendarId: settings.calendarId,
              workDays: settings.workDays,
              workStart: settings.workStart,
              workEnd: settings.workEnd,
              workTimeZone: settings.workTimeZone,
              slotMinutes: settings.slotMinutes,
              bufferMinutes: settings.bufferMinutes,
            }}
          />
        </>
      ) : section === "data" ? (
        <DataSection
          // Managed mode: a student's saved keys are never used, so there's nothing to take along.
          hasApiKey={!managed && [settings.apiKeyEnc, settings.jsearchKeyEnc, settings.adzunaKeyEnc].some((key) => key !== null)}
          managed={managed}
          exportName={exportFileName()}
          backups={{
            on: settings.nightlyBackup,
            retentionDays: env.DOSSIER_BACKUP_RETENTION_DAYS,
            dir: await backupsDir(),
            lastRun: whenRan(await lastNightlyBackup()),
            problem: settings.backupProblem,
          }}
          jobRetentionHours={settings.jobRetentionHours}
        />
      ) : section === "documents" ? (
        <>
        <DocumentsSection
          // Only these fields: the settings also hold the encrypted API key, which never leaves the server.
          initial={{
            paper: settings.paper,
            dateFormat: settings.dateFormat,
            defaultTone: settings.defaultTone,
            docLanguage: settings.docLanguage,
            resumeLanguage: settings.resumeLanguage,
            customLanguages: settings.customLanguages,
            fileNamePattern: settings.fileNamePattern,
            includeRefs: settings.includeRefs,
            pageLimit: settings.pageLimit,
          }}
          preview={await filePreview()}
        />
        {/* Managed mode has no AI provider section, so how the AI writes is set here. */}
        {managed && aiBehaviour}
        </>
      ) : (
        <AboutSection
          facts={await aboutFacts()}
          usagePing={await usagePingView()}
          updates={{ daily: settings.updateCheck, available: availableUpdate(settings) }}
        />
      )}
    </SettingsScreen>
  );
}

/** What scores the job agent's postings, and whether it's set up (#274). */
async function scoringReadiness() {
  const config = await loadScoringConfig();
  return { scorer: config.scorer, ready: (await scoringProblem(config)) === null };
}

/** The connection as the Google section shows it: never a token. */
async function googleView() {
  const connection = await googleConnection();
  if (connection.status !== "connected") return connection;
  const { lastSyncAt, ...rest } = connection;
  return { ...rest, lastSync: whenRan(lastSyncAt) };
}

/** The OAuth client as the Google section shows it: the ID, never the secret. */
async function googleClientView() {
  const { id, idState, secretState } = await loadGoogleClientConfig();
  return { id, idState, secretState };
}

/** The address this page was reached at, for the redirect URI to register. */
async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/** The file name preview uses your name and your latest application, or sample values (SET-8). */
async function filePreview() {
  const [name, latest] = await Promise.all([
    loadProfileName(),
    prisma.application.findFirst({ where: { awaitingReview: false }, orderBy: { createdAt: "desc" }, select: { company: true, role: true } }),
  ]);
  return {
    name: name.trim() || "Jane Doe",
    company: latest?.company.trim() || "Ledgerly",
    role: latest?.role.trim() || "Senior Product Designer",
  };
}

/** "today at 03:00", "yesterday at 03:00" or "on 25 Sep at 03:00", in the server's time zone. */
function whenRan(date: Date | null, now = new Date()): string | null {
  if (!date) return null;
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `on ${formatShortDate(date, now)} at ${time}`;
}

/**
 * The About rows (SET-12). Pathfinder: the database is shared by every student, so its size isn't
 * shown (and the student's own client can't run the raw query it needs); sign-in is by Google or,
 * on a trial server, the access code.
 */
async function aboutFacts(): Promise<AboutFacts> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || "Unknown";
  const [ai, applications] = await Promise.all([loadAiConfig(), prisma.application.count({ where: { awaitingReview: false } })]);
  return [
    { label: "Version", value: appVersion },
    { label: "Server", value: host },
    { label: "Database", value: "PostgreSQL" },
    { label: "Sign-in", value: signInMode() === "google" ? "Google" : "Access code (trial)" },
    { label: "AI", value: [providerOption(ai.provider).name, ai.model].filter(Boolean).join(" · ") },
    { label: "Applications", value: String(applications) },
  ];
}

/** The usage ping's switch in About (#172): the answer in effect, who gave it, and the install ID. */
async function usagePingView(): Promise<UsagePingView> {
  const settings = await loadSettings();
  return { host: USAGE_PING_HOST, ...usagePingChoice(settings), id: settings.usagePingId, production: process.env.NODE_ENV === "production" };
}

/** What Settings says at the top in managed mode: nothing about servers or providers. */
const MANAGED_DESCRIPTION = "Your account and plan, your job agent and documents, and your data.";

type StudentSectionId = (typeof STUDENT_SETTINGS_SECTIONS)[number]["id"];

function isStudentSection(id: string): id is StudentSectionId {
  return STUDENT_SETTINGS_SECTIONS.some((section) => section.id === id);
}

/** Settings for students (Pathfinder, PATHFINDER_TOOLS off): account, plan, privacy and help. */
async function StudentSettings({ param }: { param: string | string[] | undefined }) {
  const section = settingsSectionFromParam(param, STUDENT_SETTINGS_SECTIONS) as StudentSectionId;
  return (
    <SettingsScreen
      section={section}
      sections={STUDENT_SETTINGS_SECTIONS}
      description="Your account, your plan, and your data."
    >
      {await studentSection(section)}
    </SettingsScreen>
  );
}

/** One of the student's own sections: account, plan, privacy and help (Pathfinder). */
async function studentSection(section: StudentSectionId) {
  if (section === "plan") {
    const ai = await loadAiConfig();
    return <PlanSection perDay={analysesPerDay()} left={await analysesLeftToday(ai.sharedKey)} />;
  }
  if (section === "privacy") return <PrivacySection analyses={(await listResumeAnalyses()).length} tools={toolsEnabled()} />;
  if (section === "help") return <HelpSection />;
  const session = await verifySession();
  const [user, profileName] = await Promise.all([
    systemPrisma.user.findUnique({ where: { id: session.userId }, select: { email: true, name: true, firebaseUid: true } }),
    loadProfileName(),
  ]);
  return (
    <AccountSection
      email={user?.email ?? ""}
      name={profileName.trim() || user?.name.trim() || ""}
      canResetPassword={signInMode() === "firebase" && Boolean(user?.firebaseUid)}
    />
  );
}
