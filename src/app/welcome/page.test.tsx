import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import WelcomePage from "./page";

// The public homepage (Pathfinder): what a visitor is told before signing up.

vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/auth/google-sign-in", () => ({ signInMode: () => "firebase" }));
vi.mock("@/lib/ai/daily-limit", () => ({ analysesPerDay: () => 5 }));
// No prices set on the server: the paid plans say "Price coming soon" (Phase 4).
const server = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/lib/env", () => server);

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

  it("answers what students ask, linked from the top bar (Phase 5)", async () => {
    render(await WelcomePage());
    expect(screen.getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "#faq");
    const faq = within(screen.getByRole("region", { name: "Questions" }));
    expect(faq.getByText("Is it free?")).toBeInTheDocument();
    expect(faq.getByText(/doesn't automate LinkedIn, Naukri or Indeed/)).toBeInTheDocument();
    expect(faq.getByText(/never invents experience/)).toBeInTheDocument();
    expect(faq.getAllByRole("group")).toHaveLength(9);
  });

  it("compares the plans, with what each allows a day and what every plan includes (Phase 5)", async () => {
    server.env = {};
    render(await WelcomePage());
    const plans = within(screen.getByRole("list", { name: "Plans" }));
    const cards = plans.getAllByRole("listitem").filter((item) => item.parentElement?.getAttribute("aria-label") === "Plans");
    expect(cards.map((card) => within(card).getByRole("heading", { level: 3 }).textContent)).toEqual(["Free", "Weekly", "Monthly", "3 months"]);
    expect(cards[0]).toHaveTextContent("5 resume analyses a day");
    expect(cards[0]).toHaveTextContent("Up to 10 auto-applications a day");
    expect(within(cards[0]).getByRole("link", { name: "Get started free" })).toHaveAttribute("href", "/signup");
    // No prices or Razorpay keys on the server: nothing to buy yet.
    expect(cards[2]).toHaveTextContent("Price coming soon");
    expect(cards[2]).toHaveTextContent("25 resume analyses a day");
    expect(cards[2]).toHaveTextContent("Paying online opens soon.");
    expect(within(cards[2]).queryByRole("link")).toBeNull();
    const region = within(screen.getByRole("region", { name: "Plans" }));
    expect(region.getByText("Every plan includes")).toBeInTheDocument();
    expect(region.getByText(/sent from your Gmail only when you approve/)).toBeInTheDocument();
  });

  it("offers each plan with a price once Razorpay is set up (Phase 4)", async () => {
    server.env = { PATHFINDER_PRICE_MONTHLY: 499, RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "secret" };
    render(await WelcomePage());
    const plans = within(screen.getByRole("list", { name: "Plans" }));
    expect(plans.getByText("₹499 a month")).toBeInTheDocument();
    expect(plans.getByRole("link", { name: "Choose Monthly" })).toHaveAttribute("href", "/signup");
    // A plan without a price still can't be bought.
    expect(plans.queryByRole("link", { name: "Choose Weekly" })).toBeNull();
    server.env = {};
  });
});
