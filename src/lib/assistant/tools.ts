import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { countryCodeFor, countryName } from "@/lib/job-search/countries";
import { CURRENT_USER } from "@/lib/owner/scope";
import { prisma } from "@/lib/prisma";
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

/** Every assistant tool, by name. */
const TOOLS = { [updateProfile.name]: updateProfile, [setJobSearch.name]: setJobSearch } as Record<string, AssistantTool<unknown>>;

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
