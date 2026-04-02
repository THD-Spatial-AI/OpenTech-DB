/**
 * components/profile/ProfilePage.tsx
 * ────────────────────────────────────
 * User profile settings page.
 *
 * Layout
 * ──────
 * ┌─ Header (avatar + name + provider badge) ──────────────────────────────┐
 * │  ┌─ Display Name card ─────────────────────────────────────────────┐   │
 * │  │  Edit username (all providers via Supabase updateUser)          │   │
 * │  └─────────────────────────────────────────────────────────────────┘   │
 * │  ┌─ Change Password card ──────────────────────────────────────────┐   │
 * │  │  Only shown for email/password accounts                         │   │
 * │  └─────────────────────────────────────────────────────────────────┘   │
 * │  ┌─ Account Info card ─────────────────────────────────────────────┐   │
 * │  │  Email, provider, contributor status (read-only)                │   │
 * │  └─────────────────────────────────────────────────────────────────┘   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * React 19 patterns
 * ─────────────────
 * useActionState for form submit states (replaces the useState+isLoading pattern).
 * title/meta are hoisted to <head> automatically.
 */

import { useActionState, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import type { ActiveView } from "../SideNavBar";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  email:  { label: "Email / Password", icon: "mail",         color: "text-blue-600 bg-blue-100"    },
  github: { label: "GitHub",           icon: "code",         color: "text-gray-700 bg-gray-100"    },
  orcid:  { label: "ORCID",            icon: "article",      color: "text-green-700 bg-green-100"  },
};

// ── Section card wrapper ──────────────────────────────────────────────────────

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-outline-variant/10 bg-surface-container-low/40">
        <span className="material-symbols-outlined text-lg text-primary">{icon}</span>
        <h2 className="text-sm font-bold text-on-surface uppercase tracking-wide">{title}</h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

// ── Feedback pill ─────────────────────────────────────────────────────────────

function Feedback({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <p
      role="status"
      className={[
        "text-sm font-medium mt-3 flex items-center gap-2",
        ok ? "text-green-600" : "text-tertiary",
      ].join(" ")}
    >
      <span className="material-symbols-outlined text-[16px]">
        {ok ? "check_circle" : "error"}
      </span>
      {msg}
    </p>
  );
}

// ── Input field ───────────────────────────────────────────────────────────────

function Field({
  label,
  id,
  name,
  type = "text",
  defaultValue,
  autoComplete,
  required,
}: {
  label: string;
  id: string;
  name: string;
  type?: string;
  defaultValue?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-bold text-on-surface-variant uppercase tracking-wide">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        required={required}
        className="w-full bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2.5
                   text-sm text-on-surface placeholder:text-on-surface-variant/40
                   focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50
                   transition-all"
      />
    </div>
  );
}

// ── Action state shapes ───────────────────────────────────────────────────────

interface ActionResult {
  ok: boolean;
  message: string;
}

// ── DisplayName card ──────────────────────────────────────────────────────────

async function updateDisplayNameAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const username = (formData.get("username") as string | null)?.trim();
  if (!username) return { ok: false, message: "Username cannot be empty." };
  if (username.length < 2) return { ok: false, message: "Username must be at least 2 characters." };

  const { error } = await supabase.auth.updateUser({
    data: { user_name: username, name: username },
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Display name updated successfully." };
}

function DisplayNameCard({ currentUsername }: { currentUsername: string }) {
  const [result, action, isPending] = useActionState(updateDisplayNameAction, null);

  return (
    <Card title="Display Name" icon="badge">
      <form action={action} className="space-y-4">
        <Field
          label="Username"
          id="profile-username"
          name="username"
          defaultValue={currentUsername}
          autoComplete="username"
          required
        />
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold
                       bg-primary text-on-primary hover:bg-primary/90 transition-all
                       disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isPending && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-on-primary border-t-transparent animate-spin" />
            )}
            Save
          </button>
        </div>
        {result && <Feedback ok={result.ok} msg={result.message} />}
      </form>
    </Card>
  );
}

// ── ChangePassword card ───────────────────────────────────────────────────────

async function changePasswordAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const newPassword    = formData.get("newPassword") as string | null;
  const confirmPassword = formData.get("confirmPassword") as string | null;

  if (!newPassword || newPassword.length < 8) {
    return { ok: false, message: "Password must be at least 8 characters." };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, message: "Passwords do not match." };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Password updated. You may need to sign in again." };
}

function ChangePasswordCard() {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, action, isPending] = useActionState(
    async (prev: ActionResult | null, formData: FormData) => {
      const res = await changePasswordAction(prev, formData);
      if (res.ok) formRef.current?.reset();
      return res;
    },
    null
  );

  return (
    <Card title="Change Password" icon="lock">
      <form ref={formRef} action={action} className="space-y-4">
        <Field
          label="New Password"
          id="profile-new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
        />
        <Field
          label="Confirm New Password"
          id="profile-confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold
                       bg-primary text-on-primary hover:bg-primary/90 transition-all
                       disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isPending && (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-on-primary border-t-transparent animate-spin" />
            )}
            Update Password
          </button>
        </div>
        {result && <Feedback ok={result.ok} msg={result.message} />}
      </form>
    </Card>
  );
}

// ── AccountInfo card ──────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-outline-variant/10 last:border-0">
      <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant flex-shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-on-surface text-right">{value}</span>
    </div>
  );
}

function AccountInfoCard({
  user,
}: {
  user: { email: string; auth_provider: string; is_contributor: boolean; id: string };
}) {
  const provider = PROVIDER_LABELS[user.auth_provider] ?? {
    label: user.auth_provider,
    icon:  "account_circle",
    color: "text-on-surface-variant bg-surface-container",
  };

  return (
    <Card title="Account Info" icon="info">
      <div className="divide-outline-variant/10">
        <InfoRow label="Email" value={user.email || "—"} />
        <InfoRow
          label="Sign-in Method"
          value={
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${provider.color}`}
            >
              <span className="material-symbols-outlined text-[13px]">{provider.icon}</span>
              {provider.label}
            </span>
          }
        />
        <InfoRow
          label="Contributor Status"
          value={
            user.is_contributor ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full text-primary bg-primary/10">
                <span className="material-symbols-outlined text-[13px]">verified</span>
                Active Contributor
              </span>
            ) : (
              <span className="text-xs text-on-surface-variant/60">Not a contributor</span>
            )
          }
        />
        <InfoRow label="User ID" value={<code className="text-xs text-on-surface-variant/70 font-mono">{user.id.slice(0, 8)}…</code>} />
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProfilePage({ onViewChange }: { onViewChange: (v: ActiveView) => void }) {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="max-w-[1440px] mx-auto px-8 py-24 w-full flex flex-col items-center gap-6 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">lock</span>
        <p className="text-on-surface-variant text-lg">You need to be signed in to view your profile.</p>
        <button
          onClick={() => onViewChange("catalogue")}
          className="text-sm font-bold text-primary hover:underline"
        >
          ← Back to Catalogue
        </button>
      </div>
    );
  }

  const isEmailProvider = user.auth_provider === "email";
  const isExternalProvider = !isEmailProvider;

  const avatarInitial = user.username?.charAt(0).toUpperCase() ?? "?";

  return (
    <>
      <title>OpenTech DB | Profile Settings</title>
      <meta name="description" content="Manage your OpenTech DB account settings." />

      <div className="max-w-3xl mx-auto px-8 py-12 w-full">
        {/* ── Page header ──────────────────────────────────────────────────── */}
        <header className="mb-10">
          <div className="flex items-center gap-5 mb-3">
            {/* Avatar */}
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="w-16 h-16 rounded-full object-cover ring-2 ring-primary/20 flex-shrink-0"
              />
            ) : (
              <div
                className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center
                            text-2xl font-bold text-primary flex-shrink-0 ring-2 ring-primary/20"
              >
                {avatarInitial}
              </div>
            )}
            <div>
              <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">
                {user.username}
              </h1>
              <p className="text-on-surface-variant text-sm mt-1">{user.email}</p>
            </div>
          </div>
          <p className="text-on-surface-variant leading-relaxed max-w-xl ml-[84px] text-sm">
            Manage your display name, password, and account information.
          </p>
        </header>

        <div className="space-y-6">
          {/* Display Name — all providers */}
          {!isExternalProvider ? (
            <DisplayNameCard currentUsername={user.username} />
          ) : (
            <Card title="Display Name" icon="badge">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-on-surface-variant/50 text-lg mt-0.5">info</span>
                <div>
                  <p className="text-sm font-bold text-on-surface">{user.username}</p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Your display name is managed by{" "}
                    <strong>{PROVIDER_LABELS[user.auth_provider]?.label ?? user.auth_provider}</strong>.
                    Sign in with your provider to update it.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Change Password — email users only */}
          {isEmailProvider && <ChangePasswordCard />}

          {/* Account Info */}
          <AccountInfoCard user={user} />
        </div>
      </div>
    </>
  );
}
