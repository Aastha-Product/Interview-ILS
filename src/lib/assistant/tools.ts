import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ChatRole, DocumentKind } from "@/generated/prisma/enums";
import { ActionError } from "@/lib/action";
import { getAiProvider } from "@/lib/ai";
import { AGENT_JOB_KEY, agentScanJob } from "@/lib/agent/jobs";
import { agentQueryReady, agentSetupProblem } from "@/lib/agent/run";
import { runLimitProblem } from "@/lib/agent/runs";
import { isAiConfigured } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { improveSummary } from "@/lib/ai/tasks/improve-summary";
import { countryCodeFor, countryName } from "@/lib/job-search/countries";
import { refineJob, refineJobKey } from "@/lib/jobs/refine";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { CURRENT_USER } from "@/lib/owner/scope";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { toolsEnabled } from "@/lib/tools";

import type { ToolInfo } from "./assistant";

// Pathfinder assistant, Phase 2: the low-risk actions the assistant may propose. Each one changes
// only the signed-in student's own data (owner scope), and nothing runs until the student confirms
// (the panel calls runAssistantTool). Outward or destructive things — sending, applying, deleting —
// are deliberately not here. New tools slot in by adding to TOOLS.

/** One action the assistant can propose: how to describe it, check its args, summarise and run it. */
export type AssistantTool<A> = {
  name: string;
  /** For the model: what it does and the args it takes. */
  description: string;
  /** Only offered where the job tools are on. */
  tool: boolean;
  schema: z.ZodType<A>;
  /** The confirmation card text, from the validated args. */
  summarize: (args: A) => string;
  /** Makes the change and returns a short "done" sentence. */
  run: (args: A) => Promise<string>;
};

const quote = (value: string) => `“${value.trim()}”`;

const PROFILE_FIELDS = { name: "name", headline: "title", city: "city", country: "country", summary: "summary" } as const;

const updateProfile: AssistantTool<Partial<Record<keyof typeof PROFILE_FIELDS, string>>> = {
  name: "update_profile",
  description:
    "Update the student's profile basics. Args: any of name, headline (their job title), city, country, summary — each a string. Only include the ones they want to change.",
  tool: false,
  schema: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      headline: z.string().trim().min(1).max(200).optional(),
      city: z.string().trim().min(1).max(120).optional(),
      country: z.string().trim().min(1).max(120).optional(),
      summary: z.string().trim().min(1).max(2000).optional(),
    })
    .refine((fields) => Object.keys(fields).length > 0, "Nothing to change."),
  summarize: (args) =>
    `Update your profile — ${Object.entries(args)
      .map(([key, value]) => `${PROFILE_FIELDS[key as keyof typeof PROFILE_FIELDS]} to ${quote(value!)}`)
      .join(", ")}.`,
  run: async (args) => {
    const entries = Object.entries(args).filter(([, value]) => value != null) as [keyof typeof PROFILE_FIELDS, string][];
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.profileField.upsert({
          where: { userId_key: { userId: CURRENT_USER, key } },
          create: { key, value: value.trim() },
          update: { value: value.trim() },
        }),
      ),
    );
    revalidatePath("/profile");
    revalidatePath("/resume");
    if (args.name) revalidatePath("/", "layout");
    return `Updated your ${entries.map(([key]) => PROFILE_FIELDS[key]).join(", ")}.`;
  },
};

const setJobSearch: AssistantTool<{ keywords?: string; place?: string; country?: string }> = {
  name: "set_job_search",
  description:
    "Set the job agent's search (“what it looks for” in Settings → Job agent). Args: keywords (what to look for), place (city or region), country (a country name). Only include the ones to change.",
  tool: true,
  schema: z
    .object({
      keywords: z.string().trim().min(1).max(200).optional(),
      place: z.string().trim().min(1).max(200).optional(),
      country: z.string().trim().min(1).max(120).optional(),
    })
    .refine((fields) => Object.keys(fields).length > 0, "Nothing to change."),
  summarize: (args) => {
    const parts = [
      args.keywords && `look for ${quote(args.keywords)}`,
      args.place && `in ${quote(args.place)}`,
      args.country && `country ${quote(countryCodeFor(args.country) ? countryName(countryCodeFor(args.country)) : args.country)}`,
    ].filter(Boolean);
    return `Set the job search — ${parts.join(", ")}.`;
  },
  run: async (args) => {
    const { agentQuery } = await loadSettings();
    const country = args.country ? countryCodeFor(args.country) : "";
    const next = {
      ...agentQuery,
      ...(args.keywords ? { keywords: args.keywords.trim() } : {}),
      ...(args.place ? { place: args.place.trim() } : {}),
      ...(country ? { country } : {}),
    };
    await saveSettings({ agentQuery: next });
    revalidatePath("/agent");
    revalidatePath("/jobs");
    const unknownCountry = args.country && !country ? ` I couldn't match the country “${args.country.trim()}”, so I left it as it was.` : "";
    return `Updated the job agent's search.${unknownCountry}`;
  },
};

const onOff = z.enum(["on", "off"]);

const runJobAgent: AssistantTool<Record<string, never>> = {
  name: "run_job_agent",
  description: "Run the job agent now — it searches and scores new postings against the profile. No args.",
  tool: true,
  schema: z.object({}).strict(),
  summarize: () => "Run the job agent now — it searches and scores new postings.",
  run: async () => {
    const settings = await loadSettings();
    if (!settings.agentEnabled) throw new ActionError("The job agent is off. Ask me to turn it on first, then I can run it.");
    const setup = await agentSetupProblem(settings.agentQuery);
    if (setup) throw new ActionError(setup);
    const [unfinished] = await findUnfinishedJobs(AGENT_JOB_KEY);
    if (unfinished) return "A run is already going — new matches will show on the Job agent screen.";
    const limit = runLimitProblem(settings.agentRuns, new Date(), { manual: true });
    if (limit) throw new ActionError(limit);
    await startJob(agentScanJob, { manual: true }, { key: AGENT_JOB_KEY });
    revalidatePath("/agent");
    return "Started a run — new matches will show on the Job agent screen shortly.";
  },
};

const configureJobAgent: AssistantTool<{ enabled?: "on" | "off"; autoDraft?: "on" | "off" }> = {
  name: "configure_job_agent",
  description:
    "Turn the job agent on or off, and turn its “prepare drafts on its own” on or off. Args: enabled (\"on\"/\"off\"), autoDraft (\"on\"/\"off\") — include only what to change.",
  tool: true,
  schema: z
    .object({ enabled: onOff.optional(), autoDraft: onOff.optional() })
    .refine((fields) => Object.keys(fields).length > 0, "Nothing to change."),
  summarize: (args) => {
    const parts = [
      args.enabled && `turn the job agent ${args.enabled}`,
      args.autoDraft && `${args.autoDraft === "on" ? "have it prepare drafts on its own" : "stop it preparing drafts on its own"}`,
    ].filter(Boolean);
    return `${parts.join(", and ")}.`.replace(/^./, (c) => c.toUpperCase());
  },
  run: async (args) => {
    const settings = await loadSettings();
    if (args.enabled === "on" && !agentQueryReady(settings.agentQuery)) {
      throw new ActionError(
        settings.agentQuery.keywords.trim()
          ? "The job agent needs a country for its search before it can run. Ask me to set the search, or add one in Settings → Job agent."
          : "The job agent needs to know what to look for first. Ask me to set the search, or add one in Settings → Job agent.",
      );
    }
    await saveSettings({
      agentEnabled: args.enabled ? args.enabled === "on" : undefined,
      agentAutoDraft: args.autoDraft ? args.autoDraft === "on" : undefined,
    });
    revalidatePath("/agent");
    return "Updated the job agent.";
  },
};

const DOCUMENTS = { resume: DocumentKind.RESUME, letter: DocumentKind.COVER_LETTER } as const;
const docWord = (document: "resume" | "letter") => (document === "resume" ? "resume" : "cover letter");

const tailorApplication: AssistantTool<{ applicationId: string; document: "resume" | "letter"; instruction: string }> = {
  name: "tailor_application",
  description:
    "Rewrite one application's resume or cover letter by instruction — the same as the application's own chat. Args: applicationId (an id from the student's applications listed below), document (\"resume\" or \"letter\"), instruction (what to change, in their words). It starts a rewrite the student sees on that application; it never sends or submits.",
  tool: true,
  schema: z.object({
    applicationId: z.string().trim().min(1).max(64),
    document: z.enum(["resume", "letter"]),
    instruction: z.string().trim().min(1).max(2000),
  }),
  summarize: (args) => `Rewrite the ${docWord(args.document)} on that application: ${quote(args.instruction)}.`,
  run: async ({ applicationId, document, instruction }) => {
    // findUnique is owner-scoped, so only the student's own application is ever found.
    const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { company: true } });
    if (!application) throw new ActionError("I couldn't find that application — it may have been removed.");
    if (!(await isAiConfigured())) throw new ActionError("That needs an AI provider. Choose one in Settings → AI provider.");
    if ((await findUnfinishedJobs(refineJobKey(applicationId))).length > 0) {
      throw new ActionError("That application is already being rewritten. Give it a moment, then try again.");
    }
    // The same path as the application's chat (sendMessage): a chat message, then the refine job.
    const message = await prisma.chatMessage.create({ data: { applicationId, role: ChatRole.USER, text: instruction }, select: { id: true } });
    await startJob(
      refineJob,
      { applicationId, messageId: message.id, request: instruction, target: null, viewing: DOCUMENTS[document] },
      { key: refineJobKey(applicationId), applicationId },
    );
    revalidatePath(`/applications/${applicationId}`);
    const forCompany = application.company.trim() ? ` for ${application.company.trim()}` : "";
    return `Rewriting the ${docWord(document)}${forCompany} — the changes will show on the application shortly.`;
  },
};

const improveResumeSummary: AssistantTool<{ instruction?: string }> = {
  name: "improve_resume_summary",
  description:
    "Rewrite the professional summary at the top of the base resume, using AI, from the student's profile. Use this for \"improve/update my resume\" when they mean the summary. Args: instruction (optional — what they want, e.g. \"make it shorter\" or \"lead with my PM work\"). It saves the new summary to the profile; it invents nothing.",
  tool: false,
  schema: z.object({ instruction: z.string().trim().min(1).max(500).optional() }),
  summarize: (args) => `Rewrite your resume summary with AI${args.instruction ? `: ${quote(args.instruction)}` : ""}.`,
  run: async ({ instruction }) => {
    if (!(await isAiConfigured())) throw new ActionError("That needs an AI provider. Choose one in Settings → AI provider.");
    const [provider, profile, options] = await Promise.all([getAiProvider(), loadProfile(), loadTaskOptions()]);
    const { data: summary } = await improveSummary(provider, { profile, instruction }, options);
    if (!summary.trim()) throw new ActionError("The AI couldn't write a summary just now. Try again in a moment.");
    await prisma.profileField.upsert({
      where: { userId_key: { userId: CURRENT_USER, key: "summary" } },
      create: { key: "summary", value: summary.trim() },
      update: { value: summary.trim() },
    });
    revalidatePath("/profile");
    revalidatePath("/resume");
    return `Updated your resume summary:\n\n“${summary.trim()}”\n\nYou can fine-tune it on your Profile.`;
  },
};

/** Every assistant tool, by name. */
const TOOLS = {
  [updateProfile.name]: updateProfile,
  [setJobSearch.name]: setJobSearch,
  [runJobAgent.name]: runJobAgent,
  [configureJobAgent.name]: configureJobAgent,
  [tailorApplication.name]: tailorApplication,
  [improveResumeSummary.name]: improveResumeSummary,
} as Record<string, AssistantTool<unknown>>;

/** The tools on offer now: the always-on ones, plus the job tools where this server has them on. */
export function availableTools(): AssistantTool<unknown>[] {
  const on = toolsEnabled();
  return Object.values(TOOLS).filter((tool) => on || !tool.tool);
}

/** The tool by name, if it's on offer right now. */
export function assistantTool(name: string): AssistantTool<unknown> | undefined {
  return availableTools().find((tool) => tool.name === name);
}

/** What the model is told about the available tools (name + description). */
export function toolInfos(): ToolInfo[] {
  return availableTools().map(({ name, description }) => ({ name, description }));
}
