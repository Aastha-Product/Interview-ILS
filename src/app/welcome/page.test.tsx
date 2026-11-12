import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import WelcomePage from "./page";

// The public homepage (Pathfinder): what a visitor is told before signing up.

vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/auth/google-sign-in", () => ({ signInMode: () => "firebase" }));
vi.mock("@/lib/ai/daily-limit", () => ({ analysesPerDay: () => 5 }));

describe("the welcome page", () => {
  it("says what auto-apply does, that it's in pilot, and what it needs (the owner's decision)", async () => {
    render(await WelcomePage());
    const section = within(screen.getByRole("region", { name: "Auto-apply, in pilot" }));
    for (const title of ["Jobs that fit you", "From your own Chrome", "You stay in charge"]) expect(section.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    // Nothing promised that a visitor can't get today.
    expect(section.getByText(/It needs the Pathfinder extension for Chrome on a computer, which isn't in the Chrome Web Store yet/)).toBeInTheDocument();
    expect(section.getByText(/It starts as a dry run/)).toBeInTheDocument();
    expect(section.getByText(/It never makes up experience\./)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" }).querySelector('a[href="#auto-apply"]')).toHaveTextContent("Auto-apply");
  });

  it("says what the resume is used for, with auto-apply too, and still leads with the analysis", async () => {
    render(await WelcomePage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("See your resume the way an employer will");
    const privacy = within(screen.getByRole("region", { name: "Your resume stays private" }));
    expect(privacy.getByText(/to analyse it and, if you switch auto-apply on, to apply for jobs for you\. We never\s+sell it\./)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Get started free" })[0]).toHaveAttribute("href", "/signup");
  });
});
