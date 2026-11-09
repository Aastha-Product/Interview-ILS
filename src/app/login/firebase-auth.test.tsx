import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signInWithFirebase } from "./actions";
import { FirebaseAuth } from "./firebase-auth";

// Pathfinder: the Firebase sign-in, sign-up and reset forms, with Firebase itself faked.

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("next/link", () => ({ default: ({ href, ...props }: { href: string }) => <a href={href} {...props} /> }));
vi.mock("./actions", () => ({ signInWithFirebase: vi.fn() }));
vi.mock("@/components/toast", () => ({ toastResult: vi.fn() }));

const user = (verified: boolean) => ({
  email: "asha@example.com",
  emailVerified: verified,
  getIdToken: vi.fn(async () => "id-token"),
  reload: vi.fn(async () => {}),
});
const firebase = vi.hoisted(() => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updateProfile: vi.fn(),
  signInWithPopup: vi.fn(),
}));
vi.mock("firebase/app", () => ({ getApps: () => [], initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  ...firebase,
  initializeAuth: () => ({}),
  connectAuthEmulator: vi.fn(),
  inMemoryPersistence: {},
  browserPopupRedirectResolver: {},
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
}));

const config = { apiKey: "key", authDomain: "p.firebaseapp.com", projectId: "p", emulatorUrl: null };

describe("FirebaseAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signInWithFirebase).mockResolvedValue({ ok: true, data: { redirectTo: "/analyze" } });
  });

  it("signs in a verified student and hands the server Firebase's token", async () => {
    firebase.signInWithEmailAndPassword.mockResolvedValue({ user: user(true) });
    render(<FirebaseAuth config={config} mode="sign-in" next="/analyze/abc" />);
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "a good password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/analyze"));
    expect(signInWithFirebase).toHaveBeenCalledWith({ idToken: "id-token", remember: false, next: "/analyze/abc" });
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/reset-password?next=%2Fanalyze%2Fabc");
  });

  it("signs in a student whose address isn't verified, with no inbox step", async () => {
    firebase.signInWithEmailAndPassword.mockResolvedValue({ user: user(false) });
    render(<FirebaseAuth config={config} mode="sign-in" />);
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "a good password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/analyze"));
    expect(screen.queryByRole("heading", { name: "Check your inbox" })).toBeNull();
  });

  it("signs up with a name and goes straight in, without a verification email", async () => {
    const created = user(false);
    firebase.createUserWithEmailAndPassword.mockResolvedValue({ user: created });
    render(<FirebaseAuth config={config} mode="sign-up" />);
    await userEvent.type(screen.getByLabelText("Your name"), "Asha Rao");
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "a good password");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/analyze"));
    expect(firebase.updateProfile).toHaveBeenCalledWith(created, { displayName: "Asha Rao" });
    expect(firebase.sendEmailVerification).not.toHaveBeenCalled();
    expect(signInWithFirebase).toHaveBeenCalledWith({ idToken: "id-token", remember: false, next: undefined });
  });

  it("signs in with Google and hands the server Firebase's token", async () => {
    firebase.signInWithPopup.mockResolvedValue({ user: user(true) });
    render(<FirebaseAuth config={config} mode="sign-up" />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/analyze"));
    expect(signInWithFirebase).toHaveBeenCalledWith({ idToken: "id-token", remember: false, next: undefined });
  });

  it("shows the server's refusal after Google, such as an address taken by another account", async () => {
    firebase.signInWithPopup.mockResolvedValue({ user: user(true) });
    vi.mocked(signInWithFirebase).mockResolvedValue({ ok: false, error: "There's already an account with this email address." });
    render(<FirebaseAuth config={config} mode="sign-in" />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There's already an account with this email address.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("asks for a longer password before calling Firebase", async () => {
    render(<FirebaseAuth config={config} mode="sign-up" />);
    await userEvent.type(screen.getByLabelText("Your name"), "Asha");
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(firebase.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it("says the same after a reset request whether or not the account exists", async () => {
    firebase.sendPasswordResetEmail.mockRejectedValue(Object.assign(new Error("no user"), { code: "auth/user-not-found" }));
    render(<FirebaseAuth config={config} mode="reset" />);
    await userEvent.type(screen.getByLabelText("Email"), "nobody@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("If there's an account for nobody@example.com");
  });

  it("shows Firebase's refusal in plain words", async () => {
    firebase.signInWithEmailAndPassword.mockRejectedValue(Object.assign(new Error("bad"), { code: "auth/invalid-credential" }));
    render(<FirebaseAuth config={config} mode="sign-in" />);
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don't match");
  });
});
