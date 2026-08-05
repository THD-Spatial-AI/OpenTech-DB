import { useCallback, useEffect, useState } from "react";

import {
  createPersonalApiToken,
  fetchPersonalApiTokens,
  revokePersonalApiToken,
  type CreatedPersonalApiToken,
  type PersonalApiToken,
} from "../../services/api";

type TokenStatus = "active" | "expired" | "revoked";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function tokenStatus(token: PersonalApiToken): TokenStatus {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function PersonalApiTokensPanel() {
  const [tokens, setTokens] = useState<PersonalApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "full">("read");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [created, setCreated] = useState<CreatedPersonalApiToken | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTokens(await fetchPersonalApiTokens());
    } catch (loadError) {
      setError(errorMessage(loadError, "Could not load your API tokens."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const handleCreate = async () => {
    const normalizedName = name.trim();
    if (!normalizedName || creating || created) return;
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const result = await createPersonalApiToken({
        name: normalizedName,
        scope,
        expires_in_days: expiresInDays,
      });
      setCreated(result);
      setName("");
      await loadTokens();
    } catch (createError) {
      setError(errorMessage(createError, "Could not generate the API token."));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The browser could not copy the token. Select it and copy it manually.");
    }
  };

  const handleRevoke = async (token: PersonalApiToken) => {
    if (!window.confirm(`Revoke the API token “${token.name}”? This cannot be undone.`)) return;
    setRevokingId(token.id);
    setError(null);
    try {
      await revokePersonalApiToken(token.id);
      await loadTokens();
    } catch (revokeError) {
      setError(errorMessage(revokeError, "Could not revoke the API token."));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Generate a personal secret for scripts and integrations. It represents your Keycloak identity,
          but it is not your Keycloak access token and cannot be used for administrator endpoints.
        </p>
        <p className="text-xs text-on-surface-variant mt-2">
          Send it as <code className="font-mono bg-surface-container px-1.5 py-0.5 rounded">Authorization: Bearer &lt;token&gt;</code>.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2.5 text-sm text-error">
          <span aria-hidden="true" className="material-symbols-outlined text-lg flex-shrink-0">error</span>
          <span>{error}</span>
        </div>
      )}

      {created && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-50 px-4 py-4 space-y-3" role="status">
          <div className="flex items-start gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-amber-700 text-xl flex-shrink-0">warning</span>
            <div>
              <p className="text-sm font-bold text-amber-900">Copy this token now</p>
              <p className="text-xs text-amber-800 mt-0.5">For security, the complete secret will never be shown again.</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <code className="flex-1 min-w-0 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-mono break-all select-all text-on-surface">
              {created.token}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/50 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 transition-colors"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base">{copied ? "check" : "content_copy"}</span>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              setCopied(false);
            }}
            className="text-xs font-bold text-amber-900 hover:underline"
          >
            I have saved this token
          </button>
        </div>
      )}

      <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low/30 p-4 space-y-3">
        <h3 className="text-sm font-bold text-on-surface">Generate a new token</h3>
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-on-surface-variant mb-1.5">Token name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={255}
            placeholder="For example: PyPSA analysis script"
            disabled={creating || Boolean(created)}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wide text-on-surface-variant mb-1.5">Permission</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as "read" | "full")}
              disabled={creating || Boolean(created)}
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            >
              <option value="read">Read-only (recommended)</option>
              <option value="full">Read and write</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wide text-on-surface-variant mb-1.5">Expiry</span>
            <select
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(Number(event.target.value))}
              disabled={creating || Boolean(created)}
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
              <option value={0}>Never expires</option>
            </select>
          </label>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim() || creating || Boolean(created)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            <span aria-hidden="true" className={`material-symbols-outlined text-lg ${creating ? "animate-spin" : ""}`}>
              {creating ? "progress_activity" : "key"}
            </span>
            {creating ? "Generating…" : "Generate token"}
          </button>
          <p className="text-xs text-on-surface-variant">Maximum 10 active tokens. Prefer an expiry and the minimum permission.</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-on-surface mb-2">Your tokens</h3>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-on-surface-variant">
            <span aria-hidden="true" className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
            Loading tokens…
          </div>
        ) : tokens.length === 0 ? (
          <p className="rounded-lg border border-dashed border-outline-variant/40 px-4 py-4 text-sm text-on-surface-variant">
            You have not generated any API tokens.
          </p>
        ) : (
          <ul className="divide-y divide-outline-variant/20 rounded-xl border border-outline-variant/20 overflow-hidden">
            {tokens.map((token) => {
              const currentStatus = tokenStatus(token);
              const active = currentStatus === "active";
              return (
                <li key={token.id} className="flex flex-col sm:flex-row sm:items-center gap-3 bg-surface-container-lowest px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-on-surface truncate">{token.name}</span>
                      <code className="text-[11px] font-mono text-on-surface-variant">{token.token_prefix}…</code>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        active
                          ? "bg-green-100 text-green-800"
                          : "bg-surface-container text-on-surface-variant"
                      }`}>
                        {currentStatus}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {token.scope === "full" ? "Read and write" : "Read-only"}
                      {" · Expires "}{formatDate(token.expires_at)}
                      {" · Last used "}{token.last_used_at ? formatDate(token.last_used_at) : "Never"}
                    </p>
                  </div>
                  {active && (
                    <button
                      type="button"
                      onClick={() => void handleRevoke(token)}
                      disabled={revokingId === token.id}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-error/30 px-3 py-2 text-xs font-bold text-error hover:bg-error/5 disabled:opacity-50 transition-colors"
                    >
                      <span aria-hidden="true" className={`material-symbols-outlined text-base ${revokingId === token.id ? "animate-spin" : ""}`}>
                        {revokingId === token.id ? "progress_activity" : "key_off"}
                      </span>
                      {revokingId === token.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
