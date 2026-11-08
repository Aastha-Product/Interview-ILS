import { afterEach, describe, expect, it, vi } from "vitest";

import { MANAGED_UNAVAILABLE, managedMode, studentMessage, withoutStudentConfig } from "./managed";

afterEach(() => vi.unstubAllEnvs());

const studentSaved = {
  provider: "OPENAI" as const,
  baseUrl: "https://mine.example/v1",
  model: "my-model",
  apiKeyEnc: "encrypted-key",
  jobSource: "ADZUNA" as const,
  jsearchKeyEnc: "encrypted-jsearch",
  adzunaAppId: "app-1",
  adzunaKeyEnc: "encrypted-adzuna",
  scorer: "JEV" as const,
  typesafeKeyEnc: "encrypted-jev",
  googleClientId: "client.apps.googleusercontent.com",
  googleClientSecretEnc: "encrypted-secret",
  paper: "LETTER" as const,
  strict: false,
};

describe("managed mode (PATHFINDER_MANAGED)", () => {
  it("is on unless the server says off", () => {
    vi.stubEnv("PATHFINDER_MANAGED", undefined);
    expect(managedMode()).toBe(true);
    vi.stubEnv("PATHFINDER_MANAGED", "OFF ");
    expect(managedMode()).toBe(false);
    vi.stubEnv("PATHFINDER_MANAGED", "on");
    expect(managedMode()).toBe(true);
  });

  it("ignores every provider, key, source and client a student saved, and keeps their preferences", () => {
    vi.stubEnv("PATHFINDER_MANAGED", "on");
    const settings = withoutStudentConfig(studentSaved);
    for (const key of ["provider", "baseUrl", "model", "apiKeyEnc", "jobSource", "jsearchKeyEnc", "adzunaAppId", "adzunaKeyEnc", "scorer", "typesafeKeyEnc", "googleClientId", "googleClientSecretEnc"] as const) {
      expect(settings[key]).toBeNull();
    }
    expect(settings).toMatchObject({ paper: "LETTER", strict: false });
  });

  it("leaves a self-hosted server's settings as they are", () => {
    vi.stubEnv("PATHFINDER_MANAGED", "off");
    expect(withoutStudentConfig(studentSaved)).toEqual(studentSaved);
  });

  it("turns 'set it up in Settings' into a plain message, and leaves other messages alone", () => {
    vi.stubEnv("PATHFINDER_MANAGED", "on");
    expect(studentMessage("That needs an AI provider. Choose one in Settings → AI provider.")).toBe(MANAGED_UNAVAILABLE.ai);
    expect(studentMessage("JSearch didn't accept your key. Check it in Settings → Job search.")).toBe(MANAGED_UNAVAILABLE.jobs);
    expect(studentMessage("Jev isn't set up. Add its key in Settings → Scoring.")).toBe(MANAGED_UNAVAILABLE.scoring);
    expect(studentMessage("Connect Gmail in Settings → Google first.")).toBe(MANAGED_UNAVAILABLE.google);
    expect(studentMessage("That file is over 5 MB.")).toBe("That file is over 5 MB.");
    vi.stubEnv("PATHFINDER_MANAGED", "off");
    expect(studentMessage("Choose one in Settings → AI provider.")).toBe("Choose one in Settings → AI provider.");
  });
});
