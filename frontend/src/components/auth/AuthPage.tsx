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
 * Authentication is handled by the standalone Go auth service. It creates an
 * opaque HttpOnly session after authenticating against this application's
 * isolated Keycloak realm; no Keycloak token is exposed to React.
 */

import { useState, useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { z } from "zod";
import { useAuth } from "../../context/AuthContext";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  identifier: z.string().trim().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});

const RegisterSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(64, "Username is too long")
    .regex(/^[a-zA-Z0-9._-]+$/, "Only letters, numbers, ., _ and - are allowed"),
  email: z.email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must include at least one uppercase letter")
    .regex(/[a-z]/, "Must include at least one lowercase letter")
    .regex(/[0-9]/, "Must include at least one number")
    .regex(/[^A-Za-z0-9]/, "Must include at least one special character"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
  // Unchecked checkboxes are absent from FormData (null) → fails the literal.
  privacyConsent: z.literal("on", { message: "Please give your consent to create an account" }),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// ── State types ───────────────────────────────────────────────────────────────

type FormState =
  | { status: "idle" }
  | { status: "error"; issues: z.ZodIssue[]; apiError?: string }
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

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({
  onSuccess,
  login,
}: {
  onSuccess: () => void;
  login: (emailOrUsername: string, password: string) => Promise<void>;
}) {
  const emailId = useId();
  const passwordId = useId();

  const [state, formAction] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const raw = {
        identifier: formData.get("identifier") as string,
        password: formData.get("password") as string,
      };

      const result = LoginSchema.safeParse(raw);
      if (!result.success) {
        return { status: "error", issues: result.error.issues };
      }

      try {
        await login(result.data.identifier, result.data.password);
        onSuccess();
        return { status: "success" };
      } catch (error) {
        return {
          status: "error",
          issues: [],
          apiError: error instanceof Error ? error.message : "Sign-in failed.",
        };
      }
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
        name="identifier"
        label="Email or Username"
        autoComplete="username"
        placeholder="you@institution.org or your-handle"
        error={fieldError(issues, "identifier")}
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

function RegisterForm({
  onSuccess,
  register,
}: {
  onSuccess: () => void;
  register: (
    username: string,
    email: string,
    password: string,
    passwordConfirmation: string,
  ) => Promise<void>;
}) {
  const usernameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const consentId = useId();

  const [state, formAction] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const raw = {
        username: formData.get("username") as string,
        email: formData.get("email") as string,
        password: formData.get("password") as string,
        confirmPassword: formData.get("confirmPassword") as string,
        privacyConsent: formData.get("privacyConsent"),
      };

      const result = RegisterSchema.safeParse(raw);
      if (!result.success) {
        return { status: "error", issues: result.error.issues };
      }

      try {
        await register(
          result.data.username,
          result.data.email,
          result.data.password,
          result.data.confirmPassword,
        );
        onSuccess();
        return { status: "success" };
      } catch (error) {
        return {
          status: "error",
          issues: [],
          apiError: error instanceof Error ? error.message : "Registration failed.",
        };
      }
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
        id={usernameId}
        name="username"
        label="Username"
        autoComplete="username"
        placeholder="your-handle"
        error={fieldError(issues, "username")}
        hint="Letters, numbers, ., _ and - only"
      />

      <Field
        id={emailId}
        name="email"
        label="Work / Institutional Email"
        type="email"
        autoComplete="email"
        placeholder="you@institution.org"
        error={fieldError(issues, "email")}
        hint="Used for your account and contribution notifications"
      />

      <Field
        id={passwordId}
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder="8+ chars with upper/lower, number & symbol"
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

      <div className="pt-1">
        <label htmlFor={consentId} className="flex items-start gap-2.5 text-xs text-on-surface-variant leading-relaxed">
          <input
            id={consentId}
            name="privacyConsent"
            type="checkbox"
            aria-invalid={!!fieldError(issues, "privacyConsent")}
            aria-describedby={fieldError(issues, "privacyConsent") ? `${consentId}-error` : undefined}
            className="mt-0.5 h-4 w-4 flex-shrink-0 accent-primary"
          />
          <span>
            I consent to OpenTech-DB storing my username and email address to provide my
            contributor account and to attribute my submissions for review, as described in the{" "}
            <a href="/privacy" target="_blank" rel="noopener" className="underline hover:text-primary">
              privacy notice
            </a>
            . I can withdraw my consent at any time by requesting deletion of my account.
          </span>
        </label>
        {fieldError(issues, "privacyConsent") && (
          <p id={`${consentId}-error`} role="alert" className="flex items-center gap-1 text-xs text-tertiary mt-1.5 ml-6">
            <span className="material-symbols-outlined text-[14px]">error</span>
            {fieldError(issues, "privacyConsent")}
          </p>
        )}
      </div>

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
  const { login, register } = useAuth();

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

            {/* Error banner from auth redirects (?auth_error=…) */}
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
              <LoginForm key="login" onSuccess={onSuccess} login={login} />
            ) : (
              <RegisterForm key="register" onSuccess={onSuccess} register={register} />
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
