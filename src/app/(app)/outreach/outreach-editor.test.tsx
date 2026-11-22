import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { OutreachView } from "@/lib/outreach-data";

import { draftOutreachEmail, saveOutreachDraft, sendOutreachEmail } from "./actions";
import { OutreachEditor } from "./outreach-editor";

vi.mock("./actions", () => ({
  saveOutreachDraft: vi.fn(async () => ({ ok: true, data: null })),
  draftOutreachEmail: vi.fn(async () => ({ ok: true, data: null, toast: "Drafted." })),
  sendOutreachEmail: vi.fn(async () => ({ ok: true, data: null, toast: "Sent." })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/outreach/groww" }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/copy-text", () => ({ copyText: vi.fn(async () => true) }));

const view = (overrides: Partial<OutreachView> = {}): OutreachView => ({
  applicationId: "groww",
  company: "Groww",
  role: "Data Analyst",
  postingUrl: "https://jobs.example/groww",
  suggestions: ["priya@groww.in"],
  contactName: "",
  contactEmail: "",
  subject: "Applied for Data Analyst",
  body: "Hi,\n\nI applied.",
  linkedinNote: "Hi, I applied.",
  followUpBody: "",
  stage: "draft",
  sentAt: null,
  followUpSentAt: null,
  sentToday: 0,
  ...overrides,
});
const linkedin = "https://www.linkedin.com/search/results/people/?keywords=Groww%20recruiter";
const gmail = { from: "jane@gmail.com" } as const;

beforeEach(() => vi.clearAllMocks());

describe("Recruiter outreach editor (Phase 3)", () => {
  it("fills the address from the posting, and sends only once confirmed", async () => {
    const user = userEvent.setup();
    render(<OutreachEditor view={view()} sender={gmail} linkedin={linkedin} />);
    expect(screen.getByRole("link", { name: "Find Groww's recruiters on LinkedIn" })).toHaveAttribute("href", linkedin);

    await user.click(screen.getByRole("button", { name: "Send with Gmail" }));
    expect(toast).toHaveBeenCalledWith("Add the recruiter's email address first.");
    expect(sendOutreachEmail).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "priya@groww.in" }));
    await user.type(screen.getByLabelText("Name"), "Priya");
    await user.click(screen.getByRole("button", { name: "Send with Gmail" }));
    expect(saveOutreachDraft).toHaveBeenCalledWith(expect.objectContaining({ applicationId: "groww", contactName: "Priya", contactEmail: "priya@groww.in" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Send this email?" });
    expect(dialog).toHaveTextContent("To Priya <priya@groww.in>");
    await user.click(screen.getByRole("button", { name: "Send email" }));
    expect(sendOutreachEmail).toHaveBeenCalledWith({ applicationId: "groww" });
    expect(toast).toHaveBeenCalledWith("Sent.");
  });

  it("drafts with AI and saves edits", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<OutreachEditor view={view({ subject: "", body: "" })} sender={gmail} linkedin={linkedin} />);
    await user.click(screen.getByRole("button", { name: "Draft with AI" }));
    expect(draftOutreachEmail).toHaveBeenCalledWith({ applicationId: "groww" });
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(saveOutreachDraft).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Copy note" }));
    expect(toast).toHaveBeenCalledWith("Copied.");
    vi.unstubAllGlobals();
  });

  it("points to connecting Gmail, or to the missing permission", () => {
    const { rerender } = render(<OutreachEditor view={view()} sender={{ from: null, reason: "not-connected" }} linkedin={linkedin} />);
    expect(screen.getByRole("link", { name: "Connect Gmail to send" })).toHaveAttribute("href", "/settings?section=google");
    rerender(<OutreachEditor view={view()} sender={{ from: null, reason: "no-permission" }} linkedin={linkedin} />);
    expect(screen.getByRole("link", { name: "Allow sending with Gmail" })).toHaveAttribute("href", "/api/google/connect?scopes=send");
    rerender(<OutreachEditor view={view()} sender={{ from: null, reason: "not-configured" }} linkedin={linkedin} />);
    expect(screen.getByText(/isn't set up on this server/)).toBeInTheDocument();
  });

  it("once sent, keeps the email as it went and offers one follow-up when it's due", async () => {
    const user = userEvent.setup();
    const sent = { contactName: "Priya", contactEmail: "priya@groww.in", sentAt: new Date("2026-11-10T10:00:00Z") };
    const first = render(<OutreachEditor view={view({ ...sent, stage: "sent" })} sender={gmail} linkedin={linkedin} />);
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    expect(screen.getByText(/you can follow up once/)).toBeInTheDocument();
    first.unmount();

    const { rerender } = render(<OutreachEditor view={view({ ...sent, stage: "follow-up-due", followUpBody: "Hi Priya, following up." })} sender={gmail} linkedin={linkedin} />);
    await user.click(screen.getByRole("button", { name: "Send follow-up" }));
    expect(await screen.findByRole("alertdialog", { name: "Send this follow-up?" })).toHaveTextContent("Re: Applied for Data Analyst");

    rerender(<OutreachEditor view={view({ ...sent, stage: "replied" })} sender={gmail} linkedin={linkedin} />);
    expect(screen.getByText("They replied.")).toBeInTheDocument();
  });

  it("stops at the day's limit", async () => {
    const user = userEvent.setup();
    render(<OutreachEditor view={view({ contactEmail: "priya@groww.in", sentToday: 20 })} sender={gmail} linkedin={linkedin} />);
    await user.click(screen.getByRole("button", { name: "Send with Gmail" }));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Send the rest tomorrow"));
  });
});
