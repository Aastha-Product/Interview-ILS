import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OutreachScreen } from "./outreach-screen";

describe("Recruiter outreach list (Phase 3)", () => {
  it("lists each application with its stage and what to do next", () => {
    render(
      <OutreachScreen
        rows={[
          { applicationId: "a", company: "Groww", role: "Data Analyst", contact: "Priya", stage: "follow-up-due", sentAt: new Date() },
          { applicationId: "b", company: "", role: "", contact: "", stage: "none", sentAt: null },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Applications to write to recruiters about" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("Data Analyst");
    expect(first).toHaveTextContent("Groww · Priya");
    expect(first).toHaveTextContent("Follow-up due");
    expect(within(first).getByRole("link", { name: "Follow up" })).toHaveAttribute("href", "/outreach/a");
    expect(second).toHaveTextContent("Untitled role");
    expect(second).toHaveTextContent("Unknown company");
    expect(within(second).getByRole("link", { name: "Write to the recruiter" })).toHaveAttribute("href", "/outreach/b");
  });

  it("says what shows up here when nothing's been sent yet", () => {
    render(<OutreachScreen rows={[]} />);
    expect(screen.getByText(/Nothing to follow up yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Applications" })).toHaveAttribute("href", "/applications");
  });
});
