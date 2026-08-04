import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ProfilePage from "../ProfilePage";
import { useAuth } from "../../../context/AuthContext";
import {
  createPersonalApiToken,
  fetchPersonalApiTokens,
  revokePersonalApiToken,
} from "../../../services/api";

vi.mock("../../../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../../services/api", () => ({
  createPersonalApiToken: vi.fn(),
  fetchPersonalApiTokens: vi.fn(),
  revokePersonalApiToken: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);
const mockCreateToken = vi.mocked(createPersonalApiToken);
const mockFetchTokens = vi.mocked(fetchPersonalApiTokens);
const mockRevokeToken = vi.mocked(revokePersonalApiToken);

const existingToken = {
  id: 4,
  name: "Existing integration",
  token_prefix: "otdb_abcdefgh",
  scope: "read" as const,
  expires_at: "2999-01-01T00:00:00Z",
  last_used_at: null,
  revoked_at: null,
  created_at: "2026-08-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    user: {
      id: "keycloak-user-1",
      username: "researcher",
      email: "researcher@example.org",
      realm: "opentechdb",
      roles: ["contributor"],
      auth_provider: "keycloak",
      is_contributor: true,
      is_admin: false,
    },
    isLoading: false,
    isAdmin: false,
    authError: null,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    loginWithProvider: vi.fn(),
    signOut: vi.fn(async () => {}),
    manageAccount: vi.fn(),
    refreshSession: vi.fn(async () => true),
  });
  mockFetchTokens.mockResolvedValue([existingToken]);
  mockCreateToken.mockResolvedValue({
    id: 5,
    name: "PyPSA script",
    token: "otdb_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    token_prefix: "otdb_abcdefgh",
    scope: "full",
    expires_at: "2026-11-02T00:00:00Z",
    created_at: "2026-08-04T00:00:00Z",
  });
  mockRevokeToken.mockResolvedValue();
});

describe("ProfilePage personal API tokens", () => {
  it("generates a scoped token, shows the secret once, and can dismiss it", async () => {
    render(<ProfilePage onViewChange={vi.fn()} />);

    expect(await screen.findByText("Existing integration")).toBeInTheDocument();
    expect(screen.getByText("Personal API Tokens")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Token name"), "PyPSA script");
    await userEvent.selectOptions(screen.getByLabelText("Permission"), "full");
    await userEvent.click(screen.getByRole("button", { name: "Generate token" }));

    await waitFor(() => {
      expect(mockCreateToken).toHaveBeenCalledWith({
        name: "PyPSA script",
        scope: "full",
        expires_in_days: 90,
      });
    });
    expect(screen.getByText("Copy this token now")).toBeInTheDocument();
    expect(screen.getByText("otdb_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "I have saved this token" }));
    expect(screen.queryByText("otdb_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")).not.toBeInTheDocument();
  });

  it("confirms and revokes only the selected user's token", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProfilePage onViewChange={vi.fn()} />);

    await screen.findByText("Existing integration");
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(mockRevokeToken).toHaveBeenCalledWith(4));
    expect(window.confirm).toHaveBeenCalledWith(
      "Revoke the API token “Existing integration”? This cannot be undone.",
    );
  });
});
