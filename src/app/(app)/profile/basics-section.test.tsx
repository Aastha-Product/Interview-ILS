import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfilePhoto } from "@/lib/photo";
import type { Basics } from "@/lib/profile";

import { draftWorkSummary, saveBasics } from "./actions";
import { BasicsSection } from "./basics-section";

vi.mock("./actions", () => ({
  saveBasics: vi.fn(async () => ({ ok: true, data: null })),
  draftWorkSummary: vi.fn(async () => ({ ok: true, data: { summary: "Data analyst who builds SQL dashboards for finance teams." } })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));

const empty: Basics = {
  name: "", headline: "", email: "", phone: "", dob: "", website: "",
  address: "", city: "", country: "", linkedin: "", summary: "", showAge: false,
};

function Harness({ initial = empty }: { initial?: Basics }) {
  const [basics, setBasics] = useState(initial);
  const [photo, setPhoto] = useState<ProfilePhoto | null>(null);
  return <BasicsSection basics={basics} onChange={setBasics} photo={photo} onPhotoChange={setPhoto} />;
}

describe("BasicsSection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(saveBasics).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has every Basics field, labelled, with the optional ones marked (#216)", () => {
    render(<Harness />);
    for (const label of [
      "Full name", "Headline", "Email", "Phone (optional)", "Date of birth (optional)", "Website (optional)",
      "Street address (optional)", "City", "Country", "LinkedIn (optional)", "A few lines about you",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Date of birth (optional)")).toHaveAttribute("type", "date");
  });

  it("autosaves 500 ms after typing stops", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Jane Doe" } });
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(saveBasics).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(saveBasics).toHaveBeenCalledWith({ ...empty, name: "Jane Doe" });
  });

  it("saves right away when leaving a field", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Rotterdam" } });
    await act(async () => fireEvent.blur(screen.getByLabelText("City")));
    expect(saveBasics).toHaveBeenCalledWith({ ...empty, city: "Rotterdam" });
  });

  it("explains the age option, with the computed age once there's a date of birth", () => {
    render(<Harness />);
    const option = screen.getByRole("checkbox", { name: /Show my age on resumes/ });
    expect(option).not.toBeChecked();
    expect(option).toHaveAccessibleName("Show my age on resumes (add your date of birth first)");

    fireEvent.change(screen.getByLabelText("Date of birth (optional)"), { target: { value: "1992-04-18" } });
    expect(option).toHaveAccessibleName(/^Show my age on resumes \(you're \d+; off by default, as many places advise leaving it out\)$/);
  });

  it("hints at malformed email and web addresses once you leave the field, without blocking the save", async () => {
    render(<Harness />);
    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "jane@" } });
    expect(email).not.toHaveAccessibleDescription();

    await act(async () => fireEvent.blur(email));
    expect(email).toHaveAccessibleDescription("That doesn't look like an email address yet.");
    expect(saveBasics).toHaveBeenCalledWith({ ...empty, email: "jane@" });

    fireEvent.change(email, { target: { value: "jane.doe@example.com" } });
    expect(email).not.toHaveAccessibleDescription();

    const website = screen.getByLabelText("Website (optional)");
    fireEvent.change(website, { target: { value: "example.com" } });
    await act(async () => fireEvent.blur(website));
    expect(website).not.toHaveAccessibleDescription();
    fireEvent.change(website, { target: { value: "my site" } });
    expect(website).toHaveAccessibleDescription(/doesn't look like a web address/);
  });

  it("saves the age option", async () => {
    render(<Harness initial={{ ...empty, dob: "1992-04-18" }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Show my age/ }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(saveBasics).toHaveBeenCalledWith({ ...empty, dob: "1992-04-18", showAge: true });
  });

  it("drafts the summary with AI and puts it in the field only when the student uses it (Phase 1)", async () => {
    render(<Harness />);
    const field = screen.getByLabelText("A few lines about you");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Write with AI" })));
    expect(draftWorkSummary).toHaveBeenCalledWith({});
    const draft = screen.getByRole("region", { name: "AI draft of your summary" });
    expect(draft).toHaveTextContent("Data analyst who builds SQL dashboards for finance teams.");
    // Shown, not used yet.
    expect(field).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(field).toHaveValue("Data analyst who builds SQL dashboards for finance teams.");
    expect(screen.queryByRole("region", { name: "AI draft of your summary" })).toBeNull();
    // Then saved like any edit.
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(saveBasics).toHaveBeenLastCalledWith({ ...empty, summary: "Data analyst who builds SQL dashboards for finance teams." });
    // With a summary there, it offers a rewrite.
    expect(screen.getByRole("button", { name: "Rewrite with AI" })).toBeInTheDocument();
  });

  it("keeps the student's summary when they discard the draft, or when there's no draft", async () => {
    render(<Harness initial={{ ...empty, summary: "My own words." }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Rewrite with AI" })));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("A few lines about you")).toHaveValue("My own words.");
    expect(screen.queryByRole("region", { name: "AI draft of your summary" })).toBeNull();

    vi.mocked(draftWorkSummary).mockResolvedValueOnce({ ok: false, error: "Add your experience, studies or skills first, so there's something to write about." });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Rewrite with AI" })));
    expect(screen.queryByRole("region", { name: "AI draft of your summary" })).toBeNull();
    expect(screen.getByLabelText("A few lines about you")).toHaveValue("My own words.");
  });
});
