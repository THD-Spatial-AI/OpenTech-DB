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
const loginWithProvider = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    user: null,
    isLoading: false,
    isAdmin: false,
    authError: null,
    login,
    register,
    loginWithProvider,
    signOut: vi.fn(async () => {}),
    manageAccount: vi.fn(),
    refreshSession: vi.fn(async () => false),
  });
});

describe("AuthPage", () => {
  it("keeps the original split-page controls and provider buttons", async () => {
    render(<AuthPage onSuccess={vi.fn()} />);

    expect(screen.getByText("OEO-Aligned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with ORCID" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sign In" })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(loginWithProvider).toHaveBeenCalledWith("github");
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
});
