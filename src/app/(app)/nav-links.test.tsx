import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { NavLinks } from "./nav-links";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));

function currentItem(path: string) {
  pathname = path;
  const { unmount } = render(<NavLinks />);
  const current = screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
  unmount();
  return current;
}

describe("NavLinks", () => {
  it("lists the sections in the prototype's order", () => {
    render(<NavLinks />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Home",
      "Auto-apply",
      "Profile",
      "Base resume",
      "Job dashboard",
      "Find jobs",
      "Startups",
      "Agent",
      "Applications",
      "Inbox",
      "Admin",
      "Settings",
    ]);
  });

  it("leaves out the sections this server doesn't offer (Pathfinder: Startups while it's off)", () => {
    render(<NavLinks hidden={["/startups", "/admin"]} />);
    const labels = screen.getAllByRole("link").map((link) => link.textContent);
    expect(labels).not.toContain("Startups");
    expect(labels).toEqual(["Home", "Auto-apply", "Profile", "Base resume", "Job dashboard", "Find jobs", "Agent", "Applications", "Inbox", "Settings"]);
  });

  it("leaves out a group whose sections are all hidden (Pathfinder: the job-search tools while they're off)", () => {
    render(<NavLinks hidden={["/", "/resume", "/jobs", "/startups", "/agent", "/applications", "/inbox", "/auto-apply", "/admin"]} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Home", "Profile", "Settings"]);
    expect(screen.queryByText("More tools")).toBeNull();
  });

  it("marks exactly one current section", () => {
    expect(currentItem("/")).toEqual(["Job dashboard"]);
    expect(currentItem("/analyze")).toEqual(["Home"]);
    expect(currentItem("/analyze/abc123")).toEqual(["Home"]);
    expect(currentItem("/profile")).toEqual(["Profile"]);
    expect(currentItem("/resume")).toEqual(["Base resume"]);
    expect(currentItem("/jobs")).toEqual(["Find jobs"]);
    expect(currentItem("/startups")).toEqual(["Startups"]);
    expect(currentItem("/settings")).toEqual(["Settings"]);
    expect(currentItem("/admin")).toEqual(["Admin"]);
  });

  it("keeps Applications current on an application and in the new application flow", () => {
    expect(currentItem("/applications")).toEqual(["Applications"]);
    expect(currentItem("/applications/abc123")).toEqual(["Applications"]);
    expect(currentItem("/new")).toEqual(["Applications"]);
  });

  it("doesn't treat a path that only starts with the same letters as a match", () => {
    expect(currentItem("/profiles")).toEqual([]);
    expect(currentItem("/newsletter")).toEqual([]);
  });
});
