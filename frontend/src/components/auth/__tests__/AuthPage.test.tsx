import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AuthPage from "../AuthPage";
import { useAuth } from "../../../context/AuthContext";

vi.mock("../../../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);
const login = vi.fn(async () => {});
const register = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    user: null,
    isLoading: false,
    isAdmin: false,
    authError: null,
    login,
    register,
    signOut: vi.fn(async () => {}),
    manageAccount: vi.fn(),
    refreshSession: vi.fn(async () => false),
  });
});

describe("AuthPage", () => {
  it("keeps the split-page controls without GitHub/ORCID sign-in", () => {
    render(<AuthPage onSuccess={vi.fn()} />);

    expect(screen.getByText("OEO-Aligned")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with GitHub" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with ORCID" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sign In" })).toHaveAttribute("aria-selected", "true");
  });

  it("signs in with either a username or an email", async () => {
    const onSuccess = vi.fn();
    render(<AuthPage onSuccess={onSuccess} />);

    await userEvent.type(screen.getByLabelText("Email or Username"), "researcher");
    await userEvent.type(screen.getByLabelText("Password"), "Strong1!password");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith("researcher", "Strong1!password");
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });

  it("registers with both username and email", async () => {
    const onSuccess = vi.fn();
    render(<AuthPage onSuccess={onSuccess} />);

    await userEvent.click(screen.getByRole("tab", { name: "Register" }));
    await userEvent.type(screen.getByLabelText("Username"), "researcher");
    await userEvent.type(
      screen.getByLabelText("Work / Institutional Email"),
      "researcher@example.org",
    );
    await userEvent.type(screen.getByLabelText("Password"), "Strong1!password");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "Strong1!password");
    await userEvent.click(screen.getByLabelText(/I consent to OpenTech-DB storing/));
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith(
        "researcher",
        "researcher@example.org",
        "Strong1!password",
        "Strong1!password",
      );
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });

  it("does not register without privacy consent", async () => {
    render(<AuthPage onSuccess={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Register" }));
    await userEvent.type(screen.getByLabelText("Username"), "researcher");
    await userEvent.type(
      screen.getByLabelText("Work / Institutional Email"),
      "researcher@example.org",
    );
    await userEvent.type(screen.getByLabelText("Password"), "Strong1!password");
    await userEvent.type(screen.getByLabelText("Confirm Password"), "Strong1!password");
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }));

    expect(
      await screen.findByText("Please give your consent to create an account"),
    ).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });
});
