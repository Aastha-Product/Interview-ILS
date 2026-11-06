import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { missingPrivacyContacts, PRIVACY_CONTACTS } from "@/lib/privacy";

import LoginPage from "../login/page";
import PrivacyPage from "./page";

// Pathfinder: the privacy notice (India's DPDP Act), read before signing up.

vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_BACKUP_RETENTION_DAYS: 14, DOSSIER_AI_PROVIDER: undefined, DOSSIER_AI_MODEL: undefined } }));
// Signed out: the notice must render without a session.
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/auth/google-sign-in", () => ({ signInMode: () => "google" }));
vi.mock("../login/google-sign-in-form", () => ({ GoogleSignInForm: () => <form aria-label="Continue with Google" /> }));
vi.mock("../login/login-form", () => ({ LoginForm: () => <form aria-label="Sign in" /> }));

const original = { ...PRIVACY_CONTACTS };
afterEach(() => Object.assign(PRIVACY_CONTACTS, original));

describe("the privacy notice", () => {
  it("says what's kept, where and for how long, and the student's rights", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeInTheDocument();
    for (const title of ["1. Who we are", "3. What we keep, and why", "5. Where your data is stored", "6. Who else receives your data", "7. How long we keep it", "8. Your rights"]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
    const text = document.body.textContent ?? "";
    expect(text).toContain("Mumbai, India");
    expect(text).toContain("AWS Lightsail");
    expect(text).toContain("Settings → AI provider");
    expect(text).toContain("Settings → Google");
    expect(text).toContain("Delete everything");
    expect(text).toContain("Export everything");
    expect(text).toContain("Data Protection Board of India");
    // Both kinds of nightly copy, with how long they're kept.
    const retention = within(screen.getByRole("heading", { name: "7. How long we keep it" }).parentElement!);
    expect(retention.getAllByText("14 days", { exact: false })).toHaveLength(2);
  });

  it("marks the contacts that aren't filled in yet, and warns not to invite students", () => {
    render(<PrivacyPage />);
    expect(screen.getAllByText("[organisation name]")[0].tagName).toBe("MARK");
    expect(screen.getAllByText("[contact email]").length).toBeGreaterThan(0);
    expect(screen.getAllByText("[grievance officer and contact]").length).toBeGreaterThan(0);
    expect(screen.getByRole("note")).toHaveTextContent("Don't invite students until they are.");
    expect(missingPrivacyContacts()).toEqual(["organisation", "email", "grievance"]);
  });

  it("shows the contacts once they're filled in", () => {
    Object.assign(PRIVACY_CONTACTS, { organisation: "Example Careers Trust", email: "privacy@example.test", grievance: "Asha Rao, privacy@example.test" });
    render(<PrivacyPage />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(document.querySelector("mark")).toBeNull();
    expect(screen.getByText("Example Careers Trust")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "privacy@example.test" })[0]).toHaveAttribute("href", "mailto:privacy@example.test");
    expect(missingPrivacyContacts()).toEqual([]);
  });
});

describe("the sign-in page", () => {
  it("links to the privacy notice", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) } as never));
    expect(screen.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
  });
});
