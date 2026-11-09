import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { setStudentAllowance } from "./actions";
import { AllowanceForm } from "./allowance-form";

// Pathfinder: the admin console's per-student allowance: a number of free analyses a day, empty
// for the server's default.

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("./actions", () => ({ setStudentAllowance: vi.fn() }));

const save = vi.mocked(setStudentAllowance);

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue({ ok: true, data: undefined, toast: "Allowance set to 3 a day." });
});

const field = () => screen.getByRole("spinbutton", { name: "Free analyses a day for asha@example.test" });
const button = (name: string) => screen.getByRole("button", { name });

describe("AllowanceForm", () => {
  it("starts empty on the default, saves a number, and says so", async () => {
    render(<AllowanceForm userId="u1" email="asha@example.test" allowance={null} />);
    expect(field()).toHaveValue(null);
    expect(button("Save")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Default" })).toBeNull();

    await userEvent.type(field(), "3");
    await userEvent.click(button("Save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ userId: "u1", analysesPerDay: 3 }));
    expect(toast).toHaveBeenCalledWith("Allowance set to 3 a day.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("refuses numbers it can't save: negative, fractions, too many", async () => {
    render(<AllowanceForm userId="u1" email="asha@example.test" allowance={null} />);
    for (const value of ["-1", "1.5", "501"]) {
      await userEvent.clear(field());
      await userEvent.type(field(), value);
      expect(field()).toHaveAttribute("aria-invalid", "true");
      expect(button("Save")).toBeDisabled();
    }
    await userEvent.type(field(), "{Enter}");
    expect(save).not.toHaveBeenCalled();
  });

  it("puts a student back on the default", async () => {
    save.mockResolvedValue({ ok: true, data: undefined, toast: "Back on the default allowance." });
    render(<AllowanceForm userId="u2" email="asha@example.test" allowance={7} />);
    expect(field()).toHaveValue(7);
    // Unchanged: nothing to save.
    expect(button("Save")).toBeDisabled();
    await userEvent.click(button("Default"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ userId: "u2", analysesPerDay: null }));
    await waitFor(() => expect(field()).toHaveValue(null));
    expect(toast).toHaveBeenCalledWith("Back on the default allowance.");
  });

  it("saves with Enter, and shows the error when the server refuses", async () => {
    save.mockResolvedValue({ ok: false, error: "Only an admin can change a student's allowance." });
    render(<AllowanceForm userId="u1" email="asha@example.test" allowance={2} />);
    await userEvent.clear(field());
    await userEvent.type(field(), "0{Enter}");
    await waitFor(() => expect(save).toHaveBeenCalledWith({ userId: "u1", analysesPerDay: 0 }));
    expect(toast).toHaveBeenCalledWith("Only an admin can change a student's allowance.");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("saves quietly when the server sends no confirmation", async () => {
    save.mockResolvedValue({ ok: true, data: undefined });
    render(<AllowanceForm userId="u1" email="asha@example.test" allowance={null} />);
    await userEvent.type(field(), "4{Enter}");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });
});
