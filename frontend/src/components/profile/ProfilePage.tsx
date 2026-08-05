/** Read-only Keycloak profile summary plus OpenTech personal API tokens. */
import { useAuth } from "../../context/AuthContext";
import type { ActiveView } from "../SideNavBar";
import PersonalApiTokensPanel from "./PersonalApiTokensPanel";

const PROVIDER_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  keycloak: { label: "Keycloak", icon: "shield_person", color: "text-blue-700 bg-blue-100" },
  github: { label: "GitHub via Keycloak", icon: "code", color: "text-gray-700 bg-gray-100" },
  orcid: { label: "ORCID via Keycloak", icon: "article", color: "text-green-700 bg-green-100" },
};

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

export default function ProfilePage({ onViewChange }: { onViewChange: (v: ActiveView) => void }) {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="max-w-[1440px] mx-auto px-8 py-24 w-full flex flex-col items-center gap-6 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">lock</span>
        <p className="text-on-surface-variant text-lg">You need to be signed in to view your profile.</p>
        <button onClick={() => onViewChange("catalogue")} className="text-sm font-bold text-primary hover:underline">
          ← Back to Catalogue
        </button>
      </div>
    );
  }

  const provider = PROVIDER_LABELS[user.auth_provider] ?? {
    label: user.auth_provider || "Keycloak",
    icon: "shield_person",
    color: "text-on-surface-variant bg-surface-container",
  };
  const avatarInitial = user.username?.charAt(0).toUpperCase() ?? "?";

  return (
    <>
      <title>OpenTech DB | Profile</title>
      <meta name="description" content="View your OpenTech DB Keycloak profile." />

      <div className="max-w-3xl mx-auto px-8 py-12 w-full">
        <header className="mb-10">
          <div className="flex items-center gap-5 mb-3">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover ring-2 ring-primary/20" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary ring-2 ring-primary/20">
                {avatarInitial}
              </div>
            )}
            <div>
              <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">{user.username}</h1>
              <p className="text-on-surface-variant text-sm mt-1">{user.email || "No email claim"}</p>
            </div>
          </div>
        </header>

        <div className="space-y-6">
          <Card title="Account Info" icon="info">
            <InfoRow label="Username" value={user.username} />
            <InfoRow label="Email" value={user.email || "—"} />
            <InfoRow label="Realm" value={<code className="text-xs font-mono">{user.realm}</code>} />
            <InfoRow
              label="Identity"
              value={
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${provider.color}`}>
                  <span className="material-symbols-outlined text-[13px]">{provider.icon}</span>
                  {provider.label}
                </span>
              }
            />
            <InfoRow
              label="Access"
              value={user.is_admin ? "Administrator" : user.is_contributor ? "Contributor" : "Registered user"}
            />
            <InfoRow label="User ID" value={<code className="text-xs font-mono">{user.id.slice(0, 12)}…</code>} />
          </Card>

          <Card title="Personal API Tokens" icon="key">
            <PersonalApiTokensPanel />
          </Card>
        </div>
      </div>
    </>
  );
}
