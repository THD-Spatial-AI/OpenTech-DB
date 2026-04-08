/**
 * components/auth/AuthPage.tsx
 * ─────────────────────────────
 * Full-page login / registration experience.
 *
 * Layout
 * ──────
 * Split screen on lg+:
 *   Left  — decorative panel with brand identity and trust signals
 *   Right — the auth card with tab switcher (Sign In / Create Account)
 *
 * React 19 patterns
 * ─────────────────
 * • `useActionState` — manages the async submit lifecycle for both Login
 *   and Register forms; the action receives FormData natively.
 * • `useFormStatus` (in <SubmitBtn>) — reads the pending state of the
 *   nearest parent <form action={...}> automatically.
 * • Zod validates on the client before the action fires, providing instant
 *   field-level feedback without a round-trip.
 *
 * OAuth providers
 * ────────────────
 * • GitHub — handled by Supabase: signInWithOAuth({ provider: 'github' })
 *   redirects to Supabase's OAuth flow; on return the Supabase client detects
 *   the session and AuthContext.onAuthStateChange fires automatically.
 *
 * • ORCID  — handled by the FastAPI backend (GET /api/v1/auth/orcid).
 *   The backend completes the ORCID OAuth dance and redirects to
 *   /?token=<jwt>.  <OAuthCallback> in App.tsx picks that up and calls
 *   AuthContext.signIn() to store the custom JWT.
 */

import { useState, useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { z } from "zod";
import { getOrcidOAuthUrl, adminLogin } from "../../services/api";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const RegisterSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(40, "Username is too long")
    .regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, _ and - are allowed"),
  email: z.email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must include at least one uppercase letter")
    .regex(/[0-9]/, "Must include at least one number"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// ── State types ───────────────────────────────────────────────────────────────

type FormState =
  | { status: "idle" }
  | { status: "error"; issues: z.ZodIssue[]; apiError?: string }
  | { status: "confirm_email" }
  | { status: "success" };

// ── Small helpers ─────────────────────────────────────────────────────────────

function fieldError(issues: z.ZodIssue[], field: string): string | undefined {
  return issues.find((i) => i.path[0] === field)?.message;
}

// ── Submit button ─────────────────────────────────────────────────────────────

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={[
        "w-full flex items-center justify-center gap-2.5 rounded-xl px-6 py-3.5",
        "text-sm font-bold text-on-primary transition-all duration-200",
        pending
          ? "bg-primary/60 cursor-not-allowed"
          : "bg-primary hover:bg-primary-container shadow-sm hover:shadow-md active:scale-[0.98]",
      ].join(" ")}
    >
      {pending ? (
        <>
          <span className="material-symbols-outlined text-lg animate-spin">
            progress_activity
          </span>
          Please wait…
        </>
      ) : (
        label
      )}
    </button>
  );
}

// ── Field input ───────────────────────────────────────────────────────────────

function Field({
  id,
  name,
  label,
  type = "text",
  autoComplete,
  error,
  placeholder,
  hint,
}: {
  id: string;
  /** HTML name attribute for FormData — must match the key used in formData.get() */
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  error?: string;
  placeholder?: string;
  hint?: string;
}) {
  const hasError = Boolean(error);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-on-surface">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={hasError}
        aria-describedby={hasError ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={[
          "w-full rounded-lg border bg-surface-container-lowest px-3 py-2.5",
          "text-sm text-on-surface placeholder:text-on-surface-variant/40",
          "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
          "transition-colors duration-150",
          hasError
            ? "border-tertiary ring-1 ring-tertiary/30"
            : "border-outline-variant/40 hover:border-outline-variant",
        ].join(" ")}
      />
      {hasError ? (
        <p
          id={`${id}-err`}
          role="alert"
          className="flex items-center gap-1 text-xs text-tertiary font-medium"
        >
          <span className="material-symbols-outlined text-[13px]">error</span>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-on-surface-variant/60">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ── OAuth provider buttons ────────────────────────────────────────────────────

function GitHubButton() {
  const [providerError, setProviderError] = useState<string | null>(null);

  const handleGitHub = async () => {
    setProviderError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        // Supabase redirects back here after the OAuth dance; its client
        // detects the session automatically via detectSessionInUrl: true.
        redirectTo: window.location.origin,
      },
    });
    if (error) setProviderError(error.message);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void handleGitHub()}
        className="
          flex items-center justify-center gap-3 w-full rounded-xl
          border border-outline-variant/40 bg-[#24292f] text-white
          px-6 py-3 text-sm font-bold
          hover:bg-[#2d333b] active:scale-[0.98]
          transition-all duration-150 shadow-sm hover:shadow-md
          focus:outline-none focus:ring-2 focus:ring-primary/40
        "
      >
        {/* GitHub mark */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.004.07 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.349-1.088.635-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.03-2.682-.103-.253-.447-1.27.098-2.646 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.547 1.376.202 2.394.1 2.646.64.698 1.026 1.591 1.026 2.682 0 3.841-2.337 4.687-4.565 4.935.359.309.678.919.678 1.852 0 1.337-.012 2.415-.012 2.744 0 .268.18.58.688.482A10.001 10.001 0 0022 12c0-5.523-4.477-10-10-10z" />
        </svg>
        Continue with GitHub
      </button>
      {providerError && (
        <p className="text-xs text-tertiary font-medium pl-1">{providerError}</p>
      )}
    </div>
  );
}

function OrcidButton() {
  return (
    <a
      href={getOrcidOAuthUrl()}
      className="
        flex items-center justify-center gap-3 w-full rounded-xl
        border border-outline-variant/40 bg-[#a6ce39] text-[#2d4b0e]
        px-6 py-3 text-sm font-bold
        hover:bg-[#94ba2e] active:scale-[0.98]
        transition-all duration-150 shadow-sm hover:shadow-md
        focus:outline-none focus:ring-2 focus:ring-[#a6ce39]/40
      "
    >
      {/* ORCID iD logo */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 256 256"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M128 0C57.3 0 0 57.3 0 128s57.3 128 128 128 128-57.3 128-128S198.7 0 128 0zM86.3 186.2H70.9V105.2h15.4v81zM78.6 90.3c-5.2 0-8.6-3.6-8.6-8s3.4-8 8.6-8c5.3 0 8.6 3.6 8.6 8s-3.4 8-8.6 8zm113.8 95.9h-15.4v-40.6c0-10.1-3.6-17-12.5-17-6.8 0-10.9 4.6-12.7 9.1-.6 1.6-.8 3.8-.8 6.1v42.4h-15.4V135c0-6.2-.2-11.4-.4-15.9h13.4l.7 6.9h.3c2-3.4 7-8 15.1-8 10 0 17.5 6.5 17.5 20.5v47.7z" />
      </svg>
      Continue with ORCID
    </a>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────

function OrDivider() {
  return (
    <div className="flex items-center gap-3 my-1" aria-hidden="true">
      <div className="flex-1 h-px bg-outline-variant/30" />
      <span className="text-xs font-medium text-on-surface-variant/50 uppercase tracking-widest">
        or
      </span>
      <div className="flex-1 h-px bg-outline-variant/30" />
    </div>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onSuccess, signIn }: { onSuccess: () => void; signIn: (token: string) => void }) {
  const emailId = useId();
  const passwordId = useId();

  const [state, formAction] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const raw = {
        email: formData.get("email") as string,
        password: formData.get("password") as string,
      };

      const result = LoginSchema.safeParse(raw);
      if (!result.success) {
        return { status: "error", issues: result.error.issues };
      }

      // ── Admin path: try the FastAPI hardcoded-admin endpoint first ─────────
      // If it succeeds, the user is the super-admin — done.
      // Any failure (wrong credentials, backend down, etc.) → fall through to
      // Supabase so regular users are never blocked by the admin check.
      try {
        const adminResp = await adminLogin(result.data.email, result.data.password);
        signIn(adminResp.token);
        onSuccess();
        return { status: "success" };
      } catch {
        // Not the hardcoded admin — fall through to Supabase
      }

      // ── Regular Supabase path ─────────────────────────────────────────────
      const { error } = await supabase.auth.signInWithPassword(result.data);
      if (error) {
        return { status: "error", issues: [], apiError: error.message };
      }

      // AuthContext.onAuthStateChange picks up the session automatically
      onSuccess();
      return { status: "success" };
    },
    { status: "idle" }
  );

  const issues = state.status === "error" ? state.issues : [];
  const apiError = state.status === "error" ? state.apiError : undefined;

  return (
    <form action={formAction} noValidate className="space-y-4">
      {apiError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl bg-tertiary-container/40
                     border border-tertiary/20 px-4 py-3 text-sm"
        >
          <span className="material-symbols-outlined text-[18px] text-tertiary flex-shrink-0 mt-0.5">
            error
          </span>
          <p className="text-tertiary font-medium">{apiError}</p>
        </div>
      )}

      <Field
        id={emailId}
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@institution.org"
        error={fieldError(issues, "email")}
      />

      <Field
        id={passwordId}
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        error={fieldError(issues, "password")}
      />

      <div className="flex justify-end -mt-1">
        <button
          type="button"
          className="text-xs text-primary hover:underline font-medium"
        >
          Forgot password?
        </button>
      </div>

      <SubmitBtn label="Sign In" />
    </form>
  );
}

// ── Register form ─────────────────────────────────────────────────────────────

function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const usernameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();

  const [state, formAction] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const raw = {
        username: formData.get("username") as string,
        email: formData.get("email") as string,
        password: formData.get("password") as string,
        confirmPassword: formData.get("confirmPassword") as string,
      };

      const result = RegisterSchema.safeParse(raw);
      if (!result.success) {
        return { status: "error", issues: result.error.issues };
      }

      const { data, error } = await supabase.auth.signUp({
        email: result.data.email,
        password: result.data.password,
        options: {
          // Stored in user_metadata; surfaced by mapSupabaseUser in AuthContext
          data: { user_name: result.data.username },
          // Supabase sends a confirmation email with this URL as the redirect.
          // Without this, it falls back to the Site URL set in the dashboard.
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        return { status: "error", issues: [], apiError: error.message };
      }

      // If Supabase email confirmation is enabled, data.session will be null;
      // show the user a "check your inbox" message instead of closing the modal.
      if (!data.session) {
        return { status: "confirm_email" };
      }

      // Immediate session (email confirmation disabled) — same as login
      onSuccess();
      return { status: "success" };
    },
    { status: "idle" }
  );

  const issues = state.status === "error" ? state.issues : [];
  const apiError = state.status === "error" ? state.apiError : undefined;

  // Email confirmation required — replace the form with a friendly nudge
  if (state.status === "confirm_email") {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <span className="material-symbols-outlined text-5xl text-primary">
          mark_email_unread
        </span>
        <h2 className="font-headline text-lg font-bold text-on-surface">
          Check your inbox
        </h2>
        <p className="text-sm text-on-surface-variant max-w-xs leading-relaxed">
          We sent a confirmation link to your email address. Click it to
          activate your account, then sign in.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-4">
      {apiError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl bg-tertiary-container/40
                     border border-tertiary/20 px-4 py-3 text-sm"
        >
          <span className="material-symbols-outlined text-[18px] text-tertiary flex-shrink-0 mt-0.5">
            error
          </span>
          <p className="text-tertiary font-medium">{apiError}</p>
        </div>
      )}

      <Field
        id={usernameId}
        name="username"
        label="Username"
        autoComplete="username"
        placeholder="your-handle"
        error={fieldError(issues, "username")}
        hint="Letters, numbers, _ and - only"
      />

      <Field
        id={emailId}
        name="email"
        label="Work / Institutional Email"
        type="email"
        autoComplete="email"
        placeholder="you@institution.org"
        error={fieldError(issues, "email")}
        hint="Use your institutional email so we can verify your affiliation"
      />

      <Field
        id={passwordId}
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder="Min 8 chars, 1 uppercase, 1 number"
        error={fieldError(issues, "password")}
      />

      <Field
        id={confirmId}
        name="confirmPassword"
        label="Confirm Password"
        type="password"
        autoComplete="new-password"
        placeholder="Repeat your password"
        error={fieldError(issues, "confirmPassword")}
      />

      <p className="text-[11px] text-on-surface-variant/60 leading-relaxed pt-1">
        By creating an account you agree to the{" "}
        <a href="#" className="underline hover:text-primary">
          data contribution guidelines
        </a>{" "}
        and{" "}
        <a href="#" className="underline hover:text-primary">
          CC BY 4.0 licence terms
        </a>
        .
      </p>

      <SubmitBtn label="Create Account" />
    </form>
  );
}

// ── Left decorative panel ─────────────────────────────────────────────────────

function BrandPanel() {
  const CLAIMS = [
    {
      icon: "hub",
      title: "OEO-Aligned",
      body: "All technologies are semantically anchored to the Open Energy Ontology — ensuring interoperability across modelling frameworks.",
    },
    {
      icon: "verified",
      title: "Peer-Reviewed Data",
      body: "Every parameter set is traceable to an approved, peer-reviewed reference source.",
    },
    {
      icon: "code",
      title: "PyPSA & Calliope Ready",
      body: "Parameters are mapped to the exact field conventions expected by PyPSA and Calliope adapters out of the box.",
    },
    {
      icon: "groups",
      title: "Open Collaboration",
      body: "Contribute new technologies as a registered researcher. All submissions are reviewed by data stewards before publication.",
    },
  ];

  return (
    <div
      className="hidden lg:flex flex-col justify-between bg-on-surface text-surface
                 px-12 py-16 rounded-l-2xl relative overflow-hidden"
    >
      {/* Decorative grid overlay */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 39px,white 39px,white 40px)," +
            "repeating-linear-gradient(90deg,transparent,transparent 39px,white 39px,white 40px)",
        }}
      />

      {/* Brand */}
      <div className="relative z-10">
        <span className="font-headline text-2xl font-bold tracking-tight">
          OpenTech DB
        </span>
        <p className="text-surface/50 text-sm mt-1 font-label uppercase tracking-widest">
          OEO-aligned Energy Parameters
        </p>
      </div>

      {/* Claims */}
      <ul className="relative z-10 space-y-7 my-10">
        {CLAIMS.map(({ icon, title, body }) => (
          <li key={title} className="flex items-start gap-4">
            <div className="w-9 h-9 rounded-lg bg-surface/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-[20px] text-surface/80">
                {icon}
              </span>
            </div>
            <div>
              <p className="font-bold text-surface text-sm">{title}</p>
              <p className="text-surface/55 text-xs leading-relaxed mt-0.5">
                {body}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {/* Footer note */}
      <p className="relative z-10 text-[11px] text-surface/30">
        All data licensed under CC BY 4.0 — Open Energy Consortium
      </p>
    </div>
  );
}

// ── Auth card — tab switcher ──────────────────────────────────────────────────

type Tab = "login" | "register";

export default function AuthPage({ onSuccess, initialError }: { onSuccess: () => void; initialError?: string }) {
  const [tab, setTab] = useState<Tab>("login");
  const { signIn } = useAuth();

  return (
    <>
      <title>OpenTech DB | Sign In</title>
      <meta name="description" content="Sign in or create an account to contribute to opentech-db." />

      {/* Full-screen centred backdrop */}
      <div className="min-h-screen flex items-center justify-center bg-surface p-4">
        <div
          className="w-full max-w-4xl bg-surface-container-lowest rounded-2xl
                     shadow-2xl shadow-on-surface/10 overflow-hidden
                     grid lg:grid-cols-[1fr_1.1fr]"
        >
          {/* Left brand panel */}
          <BrandPanel />

          {/* Right auth card */}
          <div className="flex flex-col px-8 py-10 sm:px-12">
            {/* Header */}
            <div className="mb-7">
              {/* Mobile brand (visible on sm only) */}
              <p className="font-headline font-bold text-xl text-on-surface mb-0.5 lg:hidden">
                OpenTech DB
              </p>
              <h1 className="font-headline text-2xl font-bold text-on-surface">
                {tab === "login" ? "Welcome back" : "Create your account"}
              </h1>
              <p className="text-sm text-on-surface-variant mt-1">
                {tab === "login"
                  ? "Sign in to access the Contributor Workspace."
                  : "Join the open energy research community."}
              </p>
            </div>

            {/* Error banner from OAuth redirects (e.g. ORCID not configured) */}
            {initialError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl bg-tertiary-container/40
                           border border-tertiary/20 px-4 py-3 text-sm mb-5"
              >
                <span className="material-symbols-outlined text-[18px] text-tertiary flex-shrink-0 mt-0.5">
                  error
                </span>
                <p className="text-tertiary font-medium">{initialError}</p>
              </div>
            )}

            {/* OAuth providers — always shown */}
            <div className="flex flex-col gap-2.5">
              <GitHubButton />
              <OrcidButton />
            </div>

            <OrDivider />

            {/* Tab switcher */}
            <div
              role="tablist"
              aria-label="Authentication method"
              className="flex gap-1 mb-5 bg-surface-container rounded-lg p-1"
            >
              {(["login", "register"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={[
                    "flex-1 rounded py-2 text-sm font-semibold transition-all duration-150",
                    tab === t
                      ? "bg-surface-container-lowest text-on-surface shadow-sm"
                      : "text-on-surface-variant hover:text-on-surface",
                  ].join(" ")}
                >
                  {t === "login" ? "Sign In" : "Register"}
                </button>
              ))}
            </div>

            {/* Form panel — keyed so state resets on tab switch */}
            {tab === "login" ? (
              <LoginForm key="login" onSuccess={onSuccess} signIn={signIn} />
            ) : (
              <RegisterForm key="register" onSuccess={onSuccess} />
            )}

            {/* Switch tab hint */}
            <p className="mt-6 text-center text-xs text-on-surface-variant/70">
              {tab === "login" ? (
                <>
                  No account yet?{" "}
                  <button
                    type="button"
                    className="text-primary font-semibold hover:underline"
                    onClick={() => setTab("register")}
                  >
                    Create one for free
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="text-primary font-semibold hover:underline"
                    onClick={() => setTab("login")}
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
