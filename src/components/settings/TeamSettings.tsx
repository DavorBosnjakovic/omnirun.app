import { useState, useEffect } from "react";
import { Users, Crown, X, Send, Clock, RefreshCw, Trash2, Shield, AlertTriangle } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAuthStore } from "../../stores/authStore";
import { useTeamStore } from "../../stores/teamStore";
import { themes } from "../../config/themes";
import type { SharedProviderConfig } from "../../stores/teamStore";

// ─── Helpers ─────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDay(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    worked_on: "worked on",
    deployed: "deployed",
    member_joined: "joined the team",
    member_removed: "was removed",
    project_created: "created project",
    project_deleted: "deleted project",
  };
  return labels[action] || action;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ─── Component ───────────────────────────────────────────────

interface TeamSettingsProps {
  onNavigateTab?: (tab: string) => void;
}

function TeamSettings({ onNavigateTab }: TeamSettingsProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { user } = useAuthStore();

  const {
    team,
    members,
    invitations,
    activityLog,
    isOwner,
    hasTeam,
    isLoading,
    fetchTeam,
    updateTeamName,
    removeMember,
    sendInvitation,
    cancelInvitation,
    resendInvitation,
    setApiKeyPolicy,
  } = useTeamStore();

  // Local UI state
  const [teamName, setTeamName] = useState("");
  const [teamNameDirty, setTeamNameDirty] = useState(false);
  const [savingName, setSavingName] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);

  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  const [showShareConfirm, setShowShareConfirm] = useState(false);
  const [showStopShareConfirm, setShowStopShareConfirm] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  // Load team data on mount
  useEffect(() => {
    if (user?.id) {
      fetchTeam(user.id);
    }
  }, [user?.id]);

  // Sync team name to local state
  useEffect(() => {
    if (team?.name) {
      setTeamName(team.name);
      setTeamNameDirty(false);
    }
  }, [team?.name]);

  // ─── Handlers ────────────────────────────────────────────

  const handleSaveTeamName = async () => {
    if (!teamNameDirty || !teamName.trim()) return;
    setSavingName(true);
    await updateTeamName(teamName.trim());
    setTeamNameDirty(false);
    setSavingName(false);
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim() || !user?.id) return;
    setSendingInvite(true);
    setInviteError(null);

    const { error } = await sendInvitation(inviteEmail.trim(), user.id);

    if (error) {
      setInviteError(error);
    } else {
      setInviteEmail("");
      setShowInviteModal(false);
    }
    setSendingInvite(false);
  };

  const handleRemoveMember = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    await removeMember(removeTarget.id);
    setRemoveTarget(null);
    setRemoving(false);
  };

  const handleEnableSharedKey = async () => {
    setPolicyLoading(true);
    setPolicyError(null);

    // Read the owner's configured providers from localStorage
    try {
      const saved = localStorage.getItem("ai-providers");
      if (!saved) {
        setPolicyError("No API keys configured. Set up your API keys first.");
        setPolicyLoading(false);
        return;
      }

      const providers = JSON.parse(saved) as Array<{
        providerId: string;
        apiKey: string;
        selectedModel: string;
      }>;

      // Only share providers that have an API key set
      const keysToShare: SharedProviderConfig[] = providers
        .filter((p) => p.apiKey && p.apiKey.trim() !== "")
        .map((p) => ({
          providerId: p.providerId,
          apiKey: p.apiKey,
          selectedModel: p.selectedModel,
        }));

      if (keysToShare.length === 0) {
        setPolicyError("No API keys to share. Enter at least one API key first.");
        setPolicyLoading(false);
        return;
      }

      const { error } = await setApiKeyPolicy("shared", keysToShare);

      if (error) {
        setPolicyError(error);
      } else {
        setShowShareConfirm(false);
      }
    } catch (err: any) {
      setPolicyError(err.message || "Failed to share API keys");
    }

    setPolicyLoading(false);
  };

  const handleDisableSharedKey = async () => {
    setPolicyLoading(true);
    setPolicyError(null);

    const { error } = await setApiKeyPolicy("individual");

    if (error) {
      setPolicyError(error);
    } else {
      setShowStopShareConfirm(false);
    }
    setPolicyLoading(false);
  };

  // ─── Group activity log by day ────────────────────────────

  const groupedActivity: Record<string, typeof activityLog> = {};
  for (const entry of activityLog) {
    const day = formatDay(entry.created_at);
    if (!groupedActivity[day]) groupedActivity[day] = [];
    groupedActivity[day].push(entry);
  }

  const seatsUsed = members.length;
  const pendingCount = invitations.filter((i) => i.status === "pending").length;
  const maxSeats = team?.max_seats || 0;

  // ─── Loading & No Team states ─────────────────────────────

  if (isLoading) {
    return (
      <div className={`${t.colors.text} flex items-center justify-center py-20`}>
        <RefreshCw size={20} className="animate-spin mr-3" />
        <span className={t.colors.textMuted}>Loading team...</span>
      </div>
    );
  }

  if (!hasTeam) {
    return (
      <div className={`${t.colors.text}`}>
        <h1 className="text-2xl font-bold mb-2">Team</h1>
        <p className={`${t.colors.textMuted} mb-6`}>
          Collaborate with your team on shared projects.
        </p>

        <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-8 text-center mb-6`}>
          <Users size={40} className={`mx-auto mb-4 ${t.colors.textMuted}`} />
          <h3 className="font-semibold text-lg mb-2">Work together, one project at a time</h3>
          <p className={`${t.colors.textMuted} mb-6 max-w-lg mx-auto leading-relaxed`}>
            Invite your team and share projects. One person works on a project at a time —
            when someone's in a project, others see it's in use and get notified when it's free.
            No merge conflicts, no chaos.
          </p>
          <button
            className={`${t.colors.accent} ${t.colors.accentHover} ${
              theme === "highContrast" ? "text-black" : "text-white"
            } px-6 py-2 ${t.borderRadius}`}
            onClick={() => {
              sessionStorage.setItem("billing_plan_tab", "teams");
              onNavigateTab?.("billing");
            }}
          >
            View Team Plans
          </button>
        </div>

        {/* How it works */}
        <h3 className={`text-sm font-medium mb-3 ${t.colors.textMuted}`}>How it works</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {[
            {
              title: "Invite members",
              desc: "Add people by email. They download the app, accept the invite, and they're in.",
            },
            {
              title: "Project locking",
              desc: "When someone opens a project, it locks to them. Others see who's working and get notified when it's free.",
            },
            {
              title: "Shared or individual API keys",
              desc: "Share one API key with everyone, or let each member bring their own. If you share, your key is encrypted and stored on Omnirun's servers so members can use it — it's no longer stored only on your device. You can switch back at any time.",
            },
            {
              title: "Activity log",
              desc: "See who worked on what, who deployed, and who joined — all in one simple timeline.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className={`${t.colors.bgSecondary} ${t.borderRadius} p-4`}
            >
              <p className="text-sm font-medium mb-1">{item.title}</p>
              <p className={`text-xs ${t.colors.textMuted} leading-relaxed`}>{item.desc}</p>
            </div>
          ))}
        </div>

      </div>
    );
  }

  // ─── Main Render ──────────────────────────────────────────

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-2">Team</h1>
      <p className={`${t.colors.textMuted} mb-6`}>
        {isOwner ? "Manage your team, members, and settings." : "View your team and activity."}
      </p>

      {/* ── Team Name ──────────────────────────────────────── */}
      <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 mb-6`}>
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Team Name
        </label>
        {isOwner ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={teamName}
              onChange={(e) => {
                setTeamName(e.target.value);
                setTeamNameDirty(true);
              }}
              className={`flex-1 max-w-xs ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none`}
            />
            {teamNameDirty && (
              <button
                onClick={handleSaveTeamName}
                disabled={savingName}
                className={`${t.colors.accent} ${t.colors.accentHover} ${
                  theme === "highContrast" ? "text-black" : "text-white"
                } px-4 py-2 ${t.borderRadius} disabled:opacity-50`}
              >
                {savingName ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        ) : (
          <p className="font-medium">{team?.name}</p>
        )}
      </div>

      {/* ── API Key Policy (Owner only) ────────────────────── */}
      {isOwner && (
        <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 mb-6`}>
          <label className={`block text-sm font-medium mb-3 ${t.colors.textMuted}`}>
            API Key Policy
          </label>

          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="apiKeyPolicy"
                checked={team?.api_key_policy === "shared"}
                onChange={() => {
                  if (team?.api_key_policy !== "shared") {
                    setShowShareConfirm(true);
                  }
                }}
                className="mt-1 w-4 h-4"
              />
              <div>
                <span className="font-medium">Shared key</span>
                <span className={`text-sm block ${t.colors.textMuted}`}>
                  Team uses your API keys. All AI costs go to your account.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="apiKeyPolicy"
                checked={team?.api_key_policy === "individual"}
                onChange={() => {
                  if (team?.api_key_policy !== "individual") {
                    setShowStopShareConfirm(true);
                  }
                }}
                className="mt-1 w-4 h-4"
              />
              <div>
                <span className="font-medium">Individual keys</span>
                <span className={`text-sm block ${t.colors.textMuted}`}>
                  Each member brings their own API key and pays their provider directly.
                </span>
              </div>
            </label>
          </div>

          {team?.api_key_policy === "shared" && team?.shared_keys_updated_at && (
            <p className={`text-xs mt-3 ${t.colors.textMuted}`}>
              <Shield size={12} className="inline mr-1" />
              Keys encrypted and shared · Last updated {timeAgo(team.shared_keys_updated_at)}
            </p>
          )}
        </div>
      )}

      {/* ── API Key Policy notice (Member view) ────────────── */}
      {!isOwner && team?.api_key_policy === "shared" && (
        <div
          className={`${t.borderRadius} p-4 mb-6`}
          style={{
            background: "rgba(45, 184, 122, 0.06)",
            border: "1px solid rgba(45, 184, 122, 0.15)",
          }}
        >
          <p className="text-sm font-medium mb-1">Using team API key</p>
          <p className={`text-xs ${t.colors.textMuted}`}>
            Your team owner provides the API key. You don't need to set up your own.
          </p>
        </div>
      )}

      {!isOwner && team?.api_key_policy === "individual" && (
        <div
          className={`${t.borderRadius} p-4 mb-6`}
          style={{
            background: "rgba(59, 130, 246, 0.06)",
            border: "1px solid rgba(59, 130, 246, 0.12)",
          }}
        >
          <p className="text-sm font-medium mb-1">Individual API keys</p>
          <p className={`text-xs ${t.colors.textMuted}`}>
            Each team member uses their own API key. Set yours up in Settings → API Key.
          </p>
        </div>
      )}

      {/* ── Members ────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-sm font-medium ${t.colors.textMuted}`}>
            Members ({seatsUsed} of {maxSeats} seats{pendingCount > 0 ? ` · ${pendingCount} pending` : ""})
          </h3>
          {isOwner && seatsUsed + pendingCount < maxSeats && (
            <button
              onClick={() => {
                setInviteEmail("");
                setInviteError(null);
                setShowInviteModal(true);
              }}
              className={`text-sm ${t.colors.accent} ${t.colors.accentHover} ${
                theme === "highContrast" ? "text-black" : "text-white"
              } px-3 py-1.5 ${t.borderRadius} flex items-center gap-1.5`}
            >
              <Send size={14} />
              Invite Member
            </button>
          )}
        </div>

        <div className="space-y-2">
          {/* Active members */}
          {members.map((member) => (
            <div
              key={member.id}
              className={`${t.colors.bgSecondary} ${t.borderRadius} p-3 flex items-center justify-between`}
            >
              <div className="flex items-center gap-3">
                {/* Avatar */}
                {member.avatar_url ? (
                  <img
                    src={member.avatar_url}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className={`w-8 h-8 rounded-full ${t.colors.bgTertiary} flex items-center justify-center text-xs font-medium`}
                  >
                    {getInitials(member.display_name || member.email || "?")}
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {member.display_name || member.email}
                    </span>
                    {member.role === "owner" && (
                      <Crown size={13} className="text-yellow-500" />
                    )}
                    {member.user_id === user?.id && (
                      <span className={`text-xs ${t.colors.textMuted}`}>(you)</span>
                    )}
                  </div>
                  <p className={`text-xs ${t.colors.textMuted}`}>{member.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 ${t.colors.bgTertiary} ${t.borderRadius} capitalize`}>
                  {member.role}
                </span>
                {isOwner && member.role !== "owner" && (
                  <button
                    onClick={() =>
                      setRemoveTarget({
                        id: member.id,
                        name: member.display_name || member.email || "this member",
                      })
                    }
                    className={`${t.colors.textMuted} hover:text-red-500 p-1`}
                    title="Remove member"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Pending invitations */}
          {isOwner &&
            invitations
              .filter((inv) => inv.status === "pending")
              .map((inv) => (
                <div
                  key={inv.id}
                  className={`${t.colors.bgSecondary} ${t.borderRadius} p-3 flex items-center justify-between opacity-60`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full ${t.colors.bgTertiary} flex items-center justify-center`}
                    >
                      <Clock size={14} className={t.colors.textMuted} />
                    </div>
                    <div>
                      <span className="text-sm">{inv.email}</span>
                      <p className={`text-xs ${t.colors.textMuted}`}>
                        Invited {timeAgo(inv.created_at)} · Expires{" "}
                        {new Date(inv.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => resendInvitation(inv.id)}
                      className={`${t.colors.textMuted} hover:${t.colors.text} p-1`}
                      title="Resend invitation"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      onClick={() => cancelInvitation(inv.id)}
                      className={`${t.colors.textMuted} hover:text-red-500 p-1`}
                      title="Cancel invitation"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
        </div>
      </div>

      {/* ── Activity Log ───────────────────────────────────── */}
      <div className="mb-6">
        <h3 className={`text-sm font-medium mb-3 ${t.colors.textMuted}`}>Activity Log</h3>

        {activityLog.length === 0 ? (
          <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-6 text-center`}>
            <p className={`text-sm ${t.colors.textMuted}`}>No activity yet</p>
          </div>
        ) : (
          <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 max-h-72 overflow-y-auto`}>
            {Object.entries(groupedActivity).map(([day, entries]) => (
              <div key={day} className="mb-4 last:mb-0">
                <p className={`text-xs font-medium mb-2 ${t.colors.textMuted} uppercase tracking-wider`}>
                  {day}
                </p>
                <div className="space-y-2">
                  {entries.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2 text-sm">
                      <span className="font-medium whitespace-nowrap">
                        {entry.display_name || entry.email}
                      </span>
                      <span className={t.colors.textMuted}>
                        {actionLabel(entry.action)}
                        {entry.project_name && (
                          <> <span className={t.colors.text}>{entry.project_name}</span></>
                        )}
                      </span>
                      <span className={`${t.colors.textMuted} ml-auto whitespace-nowrap text-xs`}>
                        {timeAgo(entry.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className={`text-xs ${t.colors.textMuted} mt-3 pt-3 border-t ${t.colors.border}`}>
              Showing last 30 days
            </p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
          MODALS
          ═══════════════════════════════════════════════════════ */}

      {/* ── Invite Member Modal ────────────────────────────── */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-6 w-full max-w-md mx-4`}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Invite Member</h2>
              <button
                onClick={() => setShowInviteModal(false)}
                className={`${t.colors.textMuted} hover:${t.colors.text}`}
              >
                <X size={20} />
              </button>
            </div>

            <p className={`text-sm ${t.colors.textMuted} mb-4`}>
              Enter their email address. They'll get an invitation to join your team.
            </p>

            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className={`w-full ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 focus:outline-none mb-4`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendInvite();
              }}
            />

            {inviteError && (
              <p className="text-sm text-red-500 mb-4">{inviteError}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setShowInviteModal(false)}
                className={`flex-1 ${t.colors.bgTertiary} hover:opacity-80 px-4 py-2 ${t.borderRadius}`}
              >
                Cancel
              </button>
              <button
                onClick={handleSendInvite}
                disabled={!inviteEmail.trim() || sendingInvite}
                className={`flex-1 ${t.colors.accent} ${t.colors.accentHover} ${
                  theme === "highContrast" ? "text-black" : "text-white"
                } px-4 py-2 ${t.borderRadius} disabled:opacity-50`}
              >
                {sendingInvite ? "Sending..." : "Send Invite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove Member Confirmation ─────────────────────── */}
      {removeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-6 w-full max-w-sm mx-4`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h2 className="font-semibold">Remove member?</h2>
                <p className={`text-sm ${t.colors.textMuted}`}>
                  {removeTarget.name} will lose access immediately.
                </p>
              </div>
            </div>

            <p className={`text-sm ${t.colors.textMuted} mb-4`}>
              Their projects and work will remain intact. The seat will be freed for a new invite.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setRemoveTarget(null)}
                className={`flex-1 ${t.colors.bgTertiary} hover:opacity-80 px-4 py-2 ${t.borderRadius}`}
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveMember}
                disabled={removing}
                className={`flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 ${t.borderRadius} disabled:opacity-50`}
              >
                {removing ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share API Key Confirmation ─────────────────────── */}
      {showShareConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-6 w-full max-w-md mx-4`}>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "rgba(45, 184, 122, 0.1)" }}
              >
                <Shield size={18} style={{ color: "#2DB87A" }} />
              </div>
              <h2 className="font-semibold text-lg">Share your API key with your team?</h2>
            </div>

            <p className={`text-sm ${t.colors.textMuted} mb-4 leading-relaxed`}>
              Your API keys will be encrypted and stored securely on Omnirun's servers so
              your team members can use them. They will no longer be stored only on your device.
            </p>

            <p className={`text-sm ${t.colors.textMuted} mb-4 leading-relaxed`}>
              All AI costs will go to your API account. You can switch back to individual keys at any time.
            </p>

            {policyError && (
              <div className="flex items-start gap-2 text-sm text-red-500 mb-4">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>{policyError}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowShareConfirm(false);
                  setPolicyError(null);
                }}
                className={`flex-1 ${t.colors.bgTertiary} hover:opacity-80 px-4 py-2 ${t.borderRadius}`}
              >
                Cancel
              </button>
              <button
                onClick={handleEnableSharedKey}
                disabled={policyLoading}
                className={`flex-1 ${t.colors.accent} ${t.colors.accentHover} ${
                  theme === "highContrast" ? "text-black" : "text-white"
                } px-4 py-2 ${t.borderRadius} disabled:opacity-50`}
              >
                {policyLoading ? "Encrypting..." : "Share Key"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stop Sharing Confirmation ──────────────────────── */}
      {showStopShareConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-6 w-full max-w-md mx-4`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle size={18} className="text-amber-500" />
              </div>
              <h2 className="font-semibold text-lg">Stop sharing your API key?</h2>
            </div>

            <p className={`text-sm ${t.colors.textMuted} mb-4 leading-relaxed`}>
              Your API key will be removed from Omnirun's servers. Team members will need
              to set up their own API keys to keep working.
            </p>

            {policyError && (
              <p className="text-sm text-red-500 mb-4">{policyError}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowStopShareConfirm(false);
                  setPolicyError(null);
                }}
                className={`flex-1 ${t.colors.bgTertiary} hover:opacity-80 px-4 py-2 ${t.borderRadius}`}
              >
                Cancel
              </button>
              <button
                onClick={handleDisableSharedKey}
                disabled={policyLoading}
                className={`flex-1 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 ${t.borderRadius} disabled:opacity-50`}
              >
                {policyLoading ? "Removing..." : "Stop Sharing"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TeamSettings;