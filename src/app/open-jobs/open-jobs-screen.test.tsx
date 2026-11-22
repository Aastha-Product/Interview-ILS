import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PublicJobsView } from "@/lib/public-jobs-data";

import { OpenJobsScreen } from "./open-jobs-screen";

const view = (overrides: Partial<PublicJobsView> = {}): PublicJobsView => ({
  total: 60,
  companies: 2,
  pages: 3,
  jobs: [
    { id: "1", title: "Data Analyst", company: "Groww", location: "Bengaluru", remote: false, posted: "Today", url: "https://job-boards.greenhouse.io/groww/jobs/1" },
    { id: "2", title: "Backend Engineer", company: "Atlan", location: "", remote: true, posted: "3 days ago", url: "" },
  ],
  ...overrides,
});
const query = { q: "", city: "", remote: false, page: 2 };

describe("the open jobs board (Phase 5)", () => {
  it("lists open jobs with a link to each on the company's own board", () => {
    render(<OpenJobsScreen view={view()} query={query} signedIn={false} canSignUp />);
    expect(screen.getByRole("heading", { level: 1, name: "Open jobs in India" })).toBeInTheDocument();
    expect(screen.getByText(/60 open roles from 2 companies' own job boards, updated every few hours/)).toBeInTheDocument();
    const jobs = within(screen.getByRole("list", { name: "Open jobs" })).getAllByRole("listitem");
    expect(jobs[0]).toHaveTextContent("Groww · Bengaluru · Today");
    const link = within(jobs[0]).getByRole("link", { name: "View Data Analyst at Groww on its job board" });
    expect(link).toHaveAttribute("href", "https://job-boards.greenhouse.io/groww/jobs/1");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    // A job without a usable link has none.
    expect(jobs[1]).toHaveTextContent("Atlan · Remote · 3 days ago");
    expect(within(jobs[1]).queryByRole("link")).toBeNull();
  });

  it("searches with a plain form and pages through results by address", () => {
    render(<OpenJobsScreen view={view()} query={{ ...query, q: "analyst" }} signedIn={false} canSignUp />);
    const search = screen.getByRole("search", { name: "Search open jobs" });
    expect(search).toHaveAttribute("action", "/open-jobs");
    expect(within(search).getByLabelText("Role or company")).toHaveValue("analyst");
    expect(screen.getByText(/match your search/)).toBeInTheDocument();
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(within(pages).getByRole("link", { name: "Newer" })).toHaveAttribute("href", "/open-jobs?q=analyst");
    expect(within(pages).getByRole("link", { name: "Older" })).toHaveAttribute("href", "/open-jobs?q=analyst&page=3");
    expect(within(pages).getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("invites a visitor to sign up, and a signed-in student to set up auto-apply", () => {
    const { unmount } = render(<OpenJobsScreen view={view()} query={query} signedIn={false} canSignUp />);
    expect(screen.getByRole("link", { name: "Sign up free" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    unmount();
    render(<OpenJobsScreen view={view()} query={query} signedIn canSignUp />);
    expect(screen.getByRole("link", { name: "Set up auto-apply" })).toHaveAttribute("href", "/auto-apply");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("says when nothing matches, with a way back to every job", () => {
    render(<OpenJobsScreen view={view({ jobs: [], total: 0, pages: 0 })} query={{ ...query, q: "zzz", page: 1 }} signedIn={false} canSignUp />);
    expect(screen.getByText(/No open jobs match that/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See every open job" })).toHaveAttribute("href", "/open-jobs");
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  });
});
