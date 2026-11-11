import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAiProvider, AiError } from "@/lib/ai";
import { getSession } from "@/lib/auth/session";

import { askAssistant, runAssistantTool } from "./actions";

vi.mock("@/lib/ai", async () => {
  const { AiError } = await import("@/lib/ai/errors");
  return { getAiProvider: vi.fn(), AiError };
});
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/tools", () => ({ toolsEnabled: () => true, TOOLS_OFF_MESSAGE: "off" }));

const h = vi.hoisted(() => ({ run: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("@/lib/assistant/tools", async () => {
  const { z } = await import("zod");
  const run = vi.fn(async () => "Updated your title.");
  h.run = run;
  const tool = {
    name: "update_profile",
    description: "Update the profile basics.",
    tool: false,
    schema: z
      .object({ headline: z.string().min(1) })
      .partial()
      .refine((fields) => Object.keys(fields).length > 0, "Nothing to change."),
    summarize: (args: { headline?: string }) => `Update your title to “${args.headline}”.`,
    run,
  };
  return {
    availableTools: () => [tool],
    assistantTool: (name: string) => (name === "update_profile" ? tool : undefined),
    toolInfos: () => [{ name: tool.name, description: tool.description }],
  };
});

const provider = (reply: unknown) => ({ complete: vi.fn(async () => reply) });
const ask = (content: string) => askAssistant({ messages: [{ role: "user" as const, content }], path: "/" });

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ userId: "student-1" } as never);
  vi.mocked(getAiProvider).mockReset();
  h.run.mockClear();
});

describe("askAssistant (Pathfinder)", () => {
  it("returns the answer, the screen and no action for a plain reply", async () => {
    vi.mocked(getAiProvider).mockResolvedValue(provider({ text: "Go to your base resume.", navigate: "/resume", proposal: null }) as never);
    const result = await ask("how do I fit my resume to one page?");
    expect(result).toEqual({ ok: true, data: { text: "Go to your base resume.", navigate: "/resume", proposal: null } });
  });

  it("passes a valid proposal through with a confirmation summary", async () => {
    vi.mocked(getAiProvider).mockResolvedValue(
      provider({ text: "I'll set your title.", navigate: null, proposal: { tool: "update_profile", args: { headline: "Product Manager" } } }) as never,
    );
    const result = await ask("change my title to Product Manager");
    expect(result).toMatchObject({
      ok: true,
      data: { proposal: { tool: "update_profile", args: { headline: "Product Manager" }, summary: "Update your title to “Product Manager”." } },
    });
  });

  it("drops a proposal whose args the tool won't accept", async () => {
    vi.mocked(getAiProvider).mockResolvedValue(provider({ text: "Hmm.", navigate: null, proposal: { tool: "update_profile", args: {} } }) as never);
    expect(await ask("do something")).toMatchObject({ ok: true, data: { proposal: null } });
  });

  it("explains, kindly, when no AI provider is set up", async () => {
    vi.mocked(getAiProvider).mockRejectedValue(new Error("no provider"));
    expect(await ask("hi")).toMatchObject({ ok: false, error: expect.stringContaining("isn't set up") });
  });

  it("turns an AI failure into words for the student", async () => {
    vi.mocked(getAiProvider).mockResolvedValue({
      complete: vi.fn(async () => {
        throw new AiError("busy", "The AI is busy. Try again in a moment.");
      }),
    } as never);
    expect(await ask("hi")).toMatchObject({ ok: false, error: "The AI is busy. Try again in a moment." });
  });
});

describe("runAssistantTool (Pathfinder)", () => {
  it("re-checks the args and runs the confirmed action", async () => {
    const result = await runAssistantTool({ tool: "update_profile", args: { headline: "Product Manager" } });
    expect(result).toEqual({ ok: true, data: { done: "Updated your title." } });
    expect(h.run).toHaveBeenCalledWith({ headline: "Product Manager" });
  });

  it("refuses an unknown action", async () => {
    expect(await runAssistantTool({ tool: "delete_everything", args: {} })).toMatchObject({ ok: false, error: expect.stringContaining("isn't available") });
    expect(h.run).not.toHaveBeenCalled();
  });

  it("refuses args the tool won't accept, without running it", async () => {
    expect(await runAssistantTool({ tool: "update_profile", args: {} })).toMatchObject({ ok: false });
    expect(h.run).not.toHaveBeenCalled();
  });
});
