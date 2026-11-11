import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAiProvider, AiError } from "@/lib/ai";
import { getSession } from "@/lib/auth/session";

import { askAssistant } from "./actions";

vi.mock("@/lib/ai", async () => {
  const { AiError } = await import("@/lib/ai/errors");
  return { getAiProvider: vi.fn(), AiError };
});
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/tools", () => ({ toolsEnabled: () => true, TOOLS_OFF_MESSAGE: "off" }));

const provider = (reply: unknown) => ({ complete: vi.fn(async (_request: unknown) => reply) });

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ userId: "student-1" } as never);
  vi.mocked(getAiProvider).mockReset();
});

describe("askAssistant (Pathfinder)", () => {
  it("returns the model's answer and screen", async () => {
    vi.mocked(getAiProvider).mockResolvedValue(provider({ text: "Go to your base resume.", navigate: "/resume" }) as never);
    const result = await askAssistant({ messages: [{ role: "user", content: "how do I fit my resume to one page?" }], path: "/" });
    expect(result).toEqual({ ok: true, data: { text: "Go to your base resume.", navigate: "/resume" } });
  });

  it("asks the configured provider with the conversation and the current screen", async () => {
    const p = provider({ text: "ok", navigate: null });
    vi.mocked(getAiProvider).mockResolvedValue(p as never);
    await askAssistant({ messages: [{ role: "user", content: "where are my applications?" }], path: "/resume" });
    const call = p.complete.mock.calls[0][0] as { system: string; messages: unknown; schemaName: string };
    expect(call.system).toContain("on /resume (Base resume) right now");
    expect(call.messages).toEqual([{ role: "user", content: "where are my applications?" }]);
    expect(call.schemaName).toBe("assistant_reply");
  });

  it("explains, kindly, when no AI provider is set up", async () => {
    vi.mocked(getAiProvider).mockRejectedValue(new Error("no provider"));
    const result = await askAssistant({ messages: [{ role: "user", content: "hi" }], path: "/" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("isn't set up") });
  });

  it("turns an AI failure into words for the student", async () => {
    vi.mocked(getAiProvider).mockResolvedValue({
      complete: vi.fn(async () => {
        throw new AiError("busy", "The AI is busy. Try again in a moment.");
      }),
    } as never);
    const result = await askAssistant({ messages: [{ role: "user", content: "hi" }], path: "/" });
    expect(result).toMatchObject({ ok: false, error: "The AI is busy. Try again in a moment." });
  });

  it("needs the last message to be the student's", async () => {
    vi.mocked(getAiProvider).mockResolvedValue(provider({ text: "x", navigate: null }) as never);
    const result = await askAssistant({ messages: [{ role: "assistant", content: "hello" }], path: "/" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Ask a question") });
  });
});
