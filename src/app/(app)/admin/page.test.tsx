import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminOverview, AiTotals } from "@/lib/admin-data";
import type { JobBoardsView } from "@/lib/crawl/boards-admin";

import AdminPage, { generateMetadata } from "./page";

// Pathfinder: the admin console's page: the numbers, the AI use, the students and the feedback.

const mocks = vi.hoisted(() => ({
  overview: undefined as unknown as AdminOverview,
  ai: { model: "claude-opus-5-5" as string | null, sharedKey: true },
  session: { userId: "admin" } as { userId: string } | null,
  admin: true,
  crawling: true,
  boards: undefined as unknown as JobBoardsView,
}));
vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(async () => mocks.session),
  isAdmin: vi.fn(async () => mocks.admin),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/admin-data", () => ({ STUDENT_LIMIT: 2, loadAdminOverview: vi.fn(async () => mocks.overview) }));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: vi.fn(async () => mocks.ai) }));
vi.mock("./allowance-form", () => ({
  AllowanceForm: ({ email, allowance }: { email: string; allowance: number | null }) => (
    <span>
      allowance for {email}: {allowance ?? "default"}
    </span>
  ),
}));
vi.mock("./plan-form", () => ({
  PlanForm: ({ email, plan }: { email: string; plan: string }) => (
    <span>
      plan for {email}: {plan}
    </span>
  ),
}));
vi.mock("@/lib/crawl/boards-admin", () => ({ loadJobBoards: vi.fn(async () => mocks.boards) }));
vi.mock("@/lib/crawl/crawl", () => ({ crawlerEnabled: () => mocks.crawling }));
vi.mock("./job-boards", () => ({
  AddJobBoards: () => <form aria-label="Add job boards" />,
  BoardSwitch: ({ name, active }: { name: string; active: boolean }) => <button type="button">{`${active ? "Pause" : "Resume"} ${name}`}</button>,
}));
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

const totals = (extra: Partial<AiTotals> = {}): AiTotals => ({ calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0, ...extra });

function overview(extra: Partial<AdminOverview> = {}): AdminOverview {
  return {
    students: { total: 3, newToday: 1, new7d: 2, activeToday: 1 },
    analyses: { total: 5, today: 1, last7d: 4 },
    ai: {
      today: totals({ calls: 2, costUsd: 0.09 }),
      last7d: totals({ calls: 4, costUsd: 0.18 }),
      last30d: totals({ calls: 6, failed: 1, inputTokens: 12_000, outputTokens: 4000, costUsd: 0.27, unpriced: 2 }),
      byModel: [
        { model: "claude-opus-5-5", ...totals({ calls: 4, costUsd: 0.27 }) },
        { model: "gemini-3.5-flash", ...totals({ calls: 2, unpriced: 2 }) },
      ],
    },
    defaultAllowance: 5,
    studentList: [
      { id: "s1", email: "asha@example.test", name: "Asha Rao", joined: new Date("2026-11-08T10:00:00Z"), analyses: 2, requestsToday: 4, allowance: 10, costUsd30d: 0.27, plan: "MONTHLY", planUntil: new Date("2026-12-20T00:00:00Z") },
      { id: "s2", email: "ravi@example.test", name: "", joined: new Date("2026-11-07T10:00:00Z"), analyses: 0, requestsToday: 0, allowance: null, costUsd30d: 0, plan: "FREE", planUntil: null },
    ],
    feedback: [{ id: "f1", email: "asha@example.test", page: "/analyze", message: "Loved the strengths list.", createdAt: new Date("2026-11-08T10:00:00Z") }],
    ...extra,
  };
}

beforeEach(() => {
  mocks.overview = overview();
  mocks.ai = { model: "claude-opus-5-5", sharedKey: true };
  mocks.session = { userId: "admin" };
  mocks.admin = true;
  mocks.crawling = true;
  mocks.boards = {
    totals: { boards: 2, active: 1, openJobs: 105 },
    boards: [
      { id: "b1", name: "Okta", system: "GREENHOUSE", boardToken: "okta", countries: ["in"], active: true, openJobs: 105, lastCrawledAt: new Date("2026-11-20T10:00:00Z"), lastError: null },
      { id: "b2", name: "Acme", system: "LEVER", boardToken: "acme", countries: ["in", "sg"], active: false, openJobs: 0, lastCrawledAt: null, lastError: "No such board. Check the board's name; crawling is paused." },
    ],
  };
});

const renderPage = async () => render(await AdminPage());

describe("the admin page", () => {
  it("shows the numbers at a glance", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByText("2 new this week · 1 today")).toBeInTheDocument();
    expect(screen.getByText("4 this week · 1 today")).toBeInTheDocument();
    expect(screen.getAllByText("$0.27").length).toBeGreaterThan(0);
    expect(screen.getByText("$0.09 in the last 24 hours")).toBeInTheDocument();
  });

  it("lists AI use by period and by model, with no cost for models without a price", async () => {
    await renderPage();
    expect(screen.getByText("claude-opus-5-5", { selector: "span" })).toBeInTheDocument();
    const byModel = screen.getByRole("table", { name: "AI calls by model, last 30 days" });
    const gemini = within(byModel).getByRole("row", { name: /gemini-3\.5-flash/ });
    expect(within(gemini).getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/2 calls in the last 30 days used a model without a known price/)).toBeInTheDocument();
  });

  it("lists the students with their usage and allowance", async () => {
    await renderPage();
    const students = screen.getByRole("table", { name: "Students" });
    const asha = within(students).getByRole("row", { name: /asha@example\.test/ });
    expect(within(asha).getByText("Asha Rao")).toBeInTheDocument();
    expect(within(asha).getByText("allowance for asha@example.test: 10")).toBeInTheDocument();
    // Each student's plan, to change from here (Phase 4).
    expect(within(asha).getByText("plan for asha@example.test: MONTHLY")).toBeInTheDocument();
    expect(within(students).getByText("plan for ravi@example.test: FREE")).toBeInTheDocument();
    expect(within(students).getByText("allowance for ravi@example.test: default")).toBeInTheDocument();
    expect(screen.getByText("5 free analyses a day")).toBeInTheDocument();
    // More students than the table lists.
    expect(screen.getByText(/the latest 2/)).toBeInTheDocument();
  });

  it("lists the job boards with their jobs and status, and a way to add more (Phase 2)", async () => {
    await renderPage();
    expect(screen.getByText("1 active of 2, 105 open jobs")).toBeInTheDocument();
    expect(screen.getByText(/The crawler is on/)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add job boards" })).toBeInTheDocument();
    const boards = screen.getByRole("table", { name: "Job boards" });
    const okta = within(boards).getByRole("row", { name: /Okta/ });
    expect(within(okta).getByText("Greenhouse · okta")).toBeInTheDocument();
    expect(within(okta).getByText("Active")).toBeInTheDocument();
    expect(within(okta).getByRole("button", { name: "Pause Okta" })).toBeInTheDocument();
    const acme = within(boards).getByRole("row", { name: /Acme/ });
    expect(within(acme).getByText("in, sg")).toBeInTheDocument();
    expect(within(acme).getByText("Not yet")).toBeInTheDocument();
    expect(within(acme).getByText("Paused")).toBeInTheDocument();
    expect(within(acme).getByRole("button", { name: "Resume Acme" })).toBeInTheDocument();
  });

  it("says when the crawler is off, so new boards wait", async () => {
    mocks.crawling = false;
    await renderPage();
    expect(screen.getByText(/The crawler is off on this server \(PATHFINDER_CRAWL\)/)).toBeInTheDocument();
  });

  it("shows the latest feedback", async () => {
    await renderPage();
    expect(screen.getByText("Loved the strengths list.")).toBeInTheDocument();
    expect(screen.getByText(/asha@example\.test · .* · \/analyze/)).toBeInTheDocument();
  });

  it("says when there's nothing yet, no limit, and no shared key", async () => {
    mocks.overview = overview({
      students: { total: 0, newToday: 0, new7d: 0, activeToday: 0 },
      ai: { today: totals(), last7d: totals(), last30d: totals(), byModel: [] },
      defaultAllowance: null,
      studentList: [],
      feedback: [{ id: "f2", email: "x@example.test", page: "", message: "Hi", createdAt: new Date() }],
    });
    mocks.ai = { model: null, sharedKey: false };
    await renderPage();
    expect(screen.getByText("not set")).toBeInTheDocument();
    expect(screen.getByText(/no shared key: students can't run analyses/)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "AI calls by model, last 30 days" })).toBeNull();
    expect(screen.getByText("no limit")).toBeInTheDocument();
    expect(screen.getByText("No students yet.")).toBeInTheDocument();
    expect(screen.queryByText(/without a known price/)).toBeNull();
  });

  it("shows when there's no feedback", async () => {
    mocks.overview = overview({ feedback: [] });
    await renderPage();
    expect(screen.getByText("No feedback yet.")).toBeInTheDocument();
  });
});

describe("the admin page's title", () => {
  it("says Admin to admins only", async () => {
    expect(await generateMetadata()).toEqual({ title: "Admin" });
    mocks.admin = false;
    expect(await generateMetadata()).toEqual({});
    mocks.session = null;
    expect(await generateMetadata()).toEqual({});
  });
});
