import { useState, useEffect, useRef } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAuthStore } from "../../stores/authStore";
import { themes } from "../../config/themes";
import { refreshSession } from "../../services/authService";
import { useTeamStore } from "../../stores/teamStore";

function BillingSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Allow other pages (e.g. HomePage) to deep-link to the Teams tab
  const initialPlanTab = (() => {
    const stored = sessionStorage.getItem("billing_plan_tab");
    if (stored === "teams" || stored === "solo") {
      sessionStorage.removeItem("billing_plan_tab");
      return stored;
    }
    return "solo";
  })();
  const [planTab, setPlanTab] = useState<"solo" | "teams">(initialPlanTab);

  const { profile, user, session, fetchProfile } = useAuthStore();
  const { teams, hasTeam } = useTeamStore();
  const currentPlan = profile?.plan || "starter";
  const subscriptionStatus = profile?.subscription_status || "incomplete";
  const isSubscribed = subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const isTeamMember = hasTeam && !isSubscribed;
  const trialDaysLeft = 0; // TODO: Calculate from subscription trial_end

  // ─── Poll for plan changes after checkout ──────────────────
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const startPolling = (expectedPlan: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setCheckoutPending(true);

    let attempts = 0;
    pollingRef.current = setInterval(async () => {
      attempts++;
      await fetchProfile();

      const updatedPlan = useAuthStore.getState().profile?.plan;
      const updatedStatus = useAuthStore.getState().profile?.subscription_status;

      if (
        updatedPlan === expectedPlan &&
        (updatedStatus === "active" || updatedStatus === "trialing")
      ) {
        // Plan updated successfully
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setCheckoutPending(false);
      }

      // Stop after 2 minutes (24 attempts × 5 seconds)
      if (attempts >= 24) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setCheckoutPending(false);
      }
    }, 5000);
  };

  // ─── Get a fresh access token ──────────────────────────────
  const getFreshToken = async (): Promise<string | null> => {
    try {
      const freshSession = await refreshSession();
      if (freshSession?.access_token) {
        return freshSession.access_token;
      }
    } catch (e) {
      console.warn("Token refresh failed:", e);
    }

    // Fallback to existing token if refresh failed
    return session?.access_token || null;
  };

  // ─── Stripe Checkout ────────────────────────────────────────

  const handleCheckout = async (planId: string) => {
    if (!user) return;
    setCheckoutLoading(planId);
    setError(null);

    try {
      const interval = billingCycle === "annual" ? "yearly" : "monthly";

      const token = await getFreshToken();
      if (!token) {
        setError("Please log in to subscribe.");
        setCheckoutLoading(null);
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-create-checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ plan: planId, interval }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Checkout failed (${res.status})`);
        setCheckoutLoading(null);
        return;
      }

      // Open Stripe Checkout in the default browser
      if (data?.url) {
        try {
          const opener = await import("@tauri-apps/plugin-opener");
          const openFn = opener.openUrl || opener.open || opener.default;
          if (openFn) {
            await openFn(data.url);
          } else {
            throw new Error("No open function found");
          }
        } catch (e) {
          navigator.clipboard.writeText(data.url);
          setError("Checkout URL copied to clipboard — paste it in your browser.");
        }

        // Start polling for plan changes
        startPolling(planId);
      } else {
        setError("No checkout URL returned");
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    }

    setCheckoutLoading(null);
  };

  // ─── Stripe Customer Portal ─────────────────────────────────

  const handleManageBilling = async () => {
    if (!user) return;
    setPortalLoading(true);
    setError(null);

    try {
      const token = await getFreshToken();
      if (!token) {
        setError("Please log in first.");
        setPortalLoading(false);
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-create-portal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Portal failed (${res.status})`);
        setPortalLoading(false);
        return;
      }

      if (data?.url) {
        try {
          const opener = await import("@tauri-apps/plugin-opener");
          const openFn = opener.openUrl || opener.open || opener.default;
          if (openFn) await openFn(data.url);
          else throw new Error("No open function");
        } catch (e) {
          navigator.clipboard.writeText(data.url);
          setError("Portal URL copied to clipboard — paste it in your browser.");
        }
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    }

    setPortalLoading(false);
  };

  // ─── Plan data ──────────────────────────────────────────────

  const soloPlans = [
    {
      id: "starter",
      name: "Starter",
      monthlyPrice: 10,
      annualPrice: 100,
      description: "For solo creators & indie hackers",
      badge: null,
      features: [
        { text: "1 project", highlight: false },
        { text: "3 integrations (your choice)", highlight: false },
        { text: "Voice control", highlight: false },
        { text: "Web search", highlight: false },
        { text: "5 project templates", highlight: false },
        { text: "Last 10 chat histories", highlight: false },
        { text: "Community support", highlight: false },
      ],
      cta: "Get Started",
    },
    {
      id: "pro",
      name: "Pro",
      monthlyPrice: 29,
      annualPrice: 290,
      description: "For freelancers & power users",
      badge: "Most Popular",
      features: [
        { text: "5 projects", highlight: false },
        { text: "10 integrations (your choice)", highlight: false },
        { text: "Voice control", highlight: false },
        { text: "Web search", highlight: false },
        { text: "Full template library", highlight: false },
        { text: "Unlimited chat history", highlight: false },
        { text: "Email support", highlight: false },
      ],
      cta: "Upgrade to Pro",
    },
    {
      id: "studio",
      name: "Studio",
      monthlyPrice: 59,
      annualPrice: 590,
      description: "For serious builders & power creators",
      badge: null,
      features: [
        { text: "15 projects", highlight: false },
        { text: "25 integrations (your choice)", highlight: false },
        { text: "Voice control", highlight: false },
        { text: "Web search", highlight: false },
        { text: "Full template library", highlight: false },
        { text: "Unlimited chat history", highlight: false },
        { text: "Priority email support", highlight: false },
      ],
      cta: "Upgrade to Studio",
    },
  ];

  const teamPlans = [
    {
      id: "team",
      name: "Team",
      monthlyPrice: 99,
      annualPrice: 990,
      description: "For small teams & startups",
      badge: null,
      features: [
        { text: "5 team seats", highlight: false },
        { text: "10 projects", highlight: false },
        { text: "All integrations", highlight: false },
        { text: "Voice control", highlight: false },
        { text: "Web search", highlight: false },
        { text: "Full template library", highlight: false },
        { text: "Unlimited chat history", highlight: false },
        { text: "Activity log", highlight: false },
        { text: "Email support", highlight: false },
      ],
      cta: "Upgrade to Team",
    },
    {
      id: "business",
      name: "Business",
      monthlyPrice: 199,
      annualPrice: 1990,
      description: "For agencies & growing companies",
      badge: "Most Popular",
      features: [
        { text: "15 team seats", highlight: false },
        { text: "30 projects", highlight: false },
        { text: "All integrations", highlight: false },
        { text: "Voice control", highlight: false },
        { text: "Web search", highlight: false },
        { text: "Full template library", highlight: false },
        { text: "Unlimited chat history", highlight: false },
        { text: "Activity log", highlight: false },
        { text: "Advanced admin controls", highlight: false },
        { text: "Priority email support", highlight: false },
      ],
      cta: "Upgrade to Business",
    },
  ];

  const getPrice = (plan: (typeof soloPlans)[0]) => {
    return billingCycle === "annual" ? plan.annualPrice : plan.monthlyPrice;
  };

  const getMonthlyEquivalent = (plan: (typeof soloPlans)[0]) => {
    if (billingCycle === "annual") {
      return Math.round(plan.annualPrice / 12);
    }
    return plan.monthlyPrice;
  };

  const getAnnualSavings = (plan: (typeof soloPlans)[0]) => {
    return plan.monthlyPrice * 12 - plan.annualPrice;
  };

  const allPlans = [...soloPlans, ...teamPlans];
  const planIndex = (id: string) => allPlans.findIndex((p) => p.id === id);

  const activePlans = planTab === "solo" ? soloPlans : teamPlans;

  return (
    <div className={`${t.colors.text} max-w-6xl`}>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Plans & Billing</h1>
        <p className={`${t.colors.textMuted} mb-6`}>
          All plans are BYOK — you bring your own API keys and pay providers directly. No markup, full transparency.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className={`${t.borderRadius} p-3 mb-4 text-sm`}
          style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", color: "#F87171" }}
        >
          {error}
          <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Checkout pending banner */}
      {checkoutPending && (
        <div
          className={`${t.borderRadius} p-3 mb-4 text-sm`}
          style={{ background: "rgba(45, 184, 122, 0.1)", border: "1px solid rgba(45, 184, 122, 0.2)", color: "#5DE8A0" }}
        >
          Waiting for checkout to complete… Your plan will update automatically.
        </div>
      )}

      {/* Current plan status bar */}
      {isTeamMember ? (
        <div
          className={`${t.borderRadius} p-4 mb-8`}
          style={{
            background: "rgba(45, 184, 122, 0.06)",
            border: "1px solid rgba(45, 184, 122, 0.15)",
          }}
        >
          <div>
            <p className="font-semibold">
              Member of {teams.length === 1
                ? teams[0].name
                : `${teams.length} teams`}
            </p>
            <p className={`text-xs ${t.colors.textMuted} mt-0.5`}>
              {teams.length === 1
                ? "Team billing is managed by the team owner."
                : teams.map((tm) => tm.name).join(", ")}
            </p>
          </div>
        </div>
      ) : (
        <div
          className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 mb-8`}
        >
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold capitalize">{currentPlan} Plan</p>
                {subscriptionStatus === "trialing" && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
                    Trial
                  </span>
                )}
                {subscriptionStatus === "past_due" && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium">
                    Payment overdue
                  </span>
                )}
              </div>
              <p className={`text-xs ${t.colors.textMuted} mt-0.5`}>
                {isSubscribed
                  ? `Billed ${billingCycle === "annual" ? "annually" : "monthly"}`
                  : "No active subscription"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isSubscribed && (
                <>
                  <button
                    onClick={handleManageBilling}
                    disabled={portalLoading}
                    className={`text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                    title="Cancel subscription"
                  >
                    Cancel plan
                  </button>
                  <button
                    onClick={handleManageBilling}
                    disabled={portalLoading}
                    className={`px-3 py-1.5 ${t.borderRadius} text-sm font-medium disabled:opacity-50`}
                    style={{
                      background: "rgba(45, 184, 122, 0.15)",
                      color: "#5DE8A0",
                      border: "1px solid rgba(45, 184, 122, 0.3)",
                    }}
                  >
                    {portalLoading ? "Opening..." : "Manage billing"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Team member browsing note */}
      {isTeamMember && (
        <p className={`text-sm ${t.colors.textMuted} text-center mb-5`}>
          {planTab === "teams"
            ? "These plans are available if you ever start your own team."
            : "These plans are available if you want your own solo subscription."}
        </p>
      )}

      {/* Solo / Teams tab toggle */}
      <div className="flex items-center justify-center mb-5">
        <div
          className={`inline-flex items-center ${t.colors.bgSecondary} ${t.borderRadius} p-1 border ${t.colors.border}`}
        >
          <button
            onClick={() => setPlanTab("solo")}
            className={`px-5 py-1.5 text-sm font-medium ${t.borderRadius} transition-all duration-150 ${
              planTab === "solo"
                ? "text-white shadow-sm"
                : `${t.colors.textMuted} hover:${t.colors.text}`
            }`}
            style={planTab === "solo" ? { background: "#2DB87A" } : {}}
          >
            Solo
          </button>
          <button
            onClick={() => setPlanTab("teams")}
            className={`px-5 py-1.5 text-sm font-medium ${t.borderRadius} transition-all duration-150 ${
              planTab === "teams"
                ? "text-white shadow-sm"
                : `${t.colors.textMuted} hover:${t.colors.text}`
            }`}
            style={planTab === "teams" ? { background: "#2DB87A" } : {}}
          >
            Teams
          </button>
        </div>
      </div>

      {/* Billing cycle toggle */}
      <div className="flex items-center justify-center mb-6">
        <div
          className={`inline-flex items-center ${t.colors.bgSecondary} ${t.borderRadius} p-1 border ${t.colors.border}`}
        >
          <button
            onClick={() => setBillingCycle("monthly")}
            className={`px-4 py-1.5 text-sm font-medium ${t.borderRadius} transition-all duration-150 ${
              billingCycle === "monthly"
                ? "text-white shadow-sm"
                : `${t.colors.textMuted} hover:${t.colors.text}`
            }`}
            style={billingCycle === "monthly" ? { background: "#2DB87A" } : {}}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle("annual")}
            className={`px-4 py-1.5 text-sm font-medium ${t.borderRadius} transition-all duration-150 flex items-center gap-1.5 ${
              billingCycle === "annual"
                ? "text-white shadow-sm"
                : `${t.colors.textMuted} hover:${t.colors.text}`
            }`}
            style={billingCycle === "annual" ? { background: "#2DB87A" } : {}}
          >
            Annual
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                billingCycle === "annual"
                  ? "bg-white/20 text-white"
                  : "bg-green-500/15 text-green-400"
              }`}
            >
              Save ~15%
            </span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {activePlans.map((plan) => {
          const isCurrent = isSubscribed && currentPlan === plan.id;
          const isPopular = plan.badge === "Most Popular";
          const isUpgrade = isSubscribed ? planIndex(plan.id) > planIndex(currentPlan) : true;
          const isLoading = checkoutLoading === plan.id;

          return (
            <div
              key={plan.id}
              className={`relative ${t.colors.bgSecondary} ${t.borderRadius} p-5 flex flex-col transition-all duration-150`}
              style={{
                border: isPopular
                  ? "2px solid #2DB87A"
                  : isCurrent
                  ? "2px solid #2A2A2A"
                  : "1px solid #1E1E1E",
                ...(isPopular
                  ? { boxShadow: "0 0 20px rgba(45, 184, 122, 0.12)" }
                  : {}),
              }}
            >
              {/* Popular badge */}
              {isPopular && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold px-3 py-0.5 rounded-full text-white"
                  style={{ background: "#2DB87A" }}
                >
                  {plan.badge}
                </div>
              )}

              {/* Plan header */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-lg">{plan.name}</h3>
                  {isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
                      Current
                    </span>
                  )}
                </div>
                <p className={`text-xs ${t.colors.textMuted}`}>{plan.description}</p>
              </div>

              {/* Price */}
              <div className="mb-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">
                    €{getMonthlyEquivalent(plan)}
                  </span>
                  <span className={`text-sm ${t.colors.textMuted}`}>/mo</span>
                </div>
                {billingCycle === "annual" ? (
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-sm font-medium ${t.colors.text}`}>
                      €{getPrice(plan)}/year
                    </span>
                    <span className="text-xs text-green-400 font-medium">
                      Save €{getAnnualSavings(plan)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-1">
                    <span className={`text-xs ${t.colors.textMuted}`}>billed monthly</span>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div
                className="mb-4"
                style={{ height: 1, background: "#1E1E1E" }}
              />

              {/* Features */}
              <ul className="space-y-2.5 mb-5 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span
                      className="mt-[7px] flex-shrink-0 rounded-full"
                      style={{
                        width: 5,
                        height: 5,
                        background: feature.highlight ? "#2DB87A" : "#555555",
                      }}
                    />
                    <span
                      className={
                        feature.highlight ? t.colors.text : t.colors.textMuted
                      }
                    >
                      {feature.text}
                    </span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {isCurrent ? (
                <div
                  className={`w-full py-2 ${t.borderRadius} text-sm font-medium text-center`}
                  style={{
                    background: "rgba(34, 197, 94, 0.1)",
                    color: "#22C55E",
                    border: "1px solid rgba(34, 197, 94, 0.2)",
                  }}
                >
                  Current Plan
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (isSubscribed) {
                      handleManageBilling();
                    } else {
                      handleCheckout(plan.id);
                    }
                  }}
                  disabled={isLoading || portalLoading || checkoutPending}
                  className={`w-full py-2 ${t.borderRadius} text-sm font-medium transition-all duration-150 disabled:opacity-50`}
                  style={
                    isPopular
                      ? { background: "#2DB87A", color: "#FFFFFF" }
                      : isUpgrade
                      ? {
                          background: "rgba(45, 184, 122, 0.12)",
                          color: "#5DE8A0",
                          border: "1px solid rgba(45, 184, 122, 0.3)",
                        }
                      : {
                          background: "transparent",
                          color: "#888888",
                          border: "1px solid #2A2A2A",
                        }
                  }
                  onMouseEnter={(e) => {
                    if (isPopular) {
                      e.currentTarget.style.background = "#1a9e63";
                    } else if (isUpgrade) {
                      e.currentTarget.style.background =
                        "rgba(45, 184, 122, 0.2)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isPopular) {
                      e.currentTarget.style.background = "#2DB87A";
                    } else if (isUpgrade) {
                      e.currentTarget.style.background =
                        "rgba(45, 184, 122, 0.12)";
                    }
                  }}
                >
                  {isLoading ? "Opening checkout..." : !isSubscribed ? plan.cta.replace("Upgrade to ", "Get ") : isUpgrade ? plan.cta : "Downgrade"}
                </button>
              )}
            </div>
          );
        })}

        {/* Enterprise card — Teams tab only */}
        {planTab === "teams" && (
          <div
            className={`relative ${t.colors.bgSecondary} ${t.borderRadius} p-5 flex flex-col transition-all duration-150`}
            style={{
              border: "1px solid rgba(45, 184, 122, 0.15)",
              background:
                "linear-gradient(180deg, rgba(45, 184, 122, 0.06) 0%, transparent 100%)",
            }}
          >
            {/* Header */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">Enterprise</h3>
              </div>
              <p className={`text-xs ${t.colors.textMuted}`}>
                For orgs with custom needs
              </p>
            </div>

            {/* Price */}
            <div className="mb-4">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold">Custom</span>
              </div>
              <div className="mt-1">
                <span className={`text-xs ${t.colors.textMuted}`}>
                  tailored to your team
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="mb-4" style={{ height: 1, background: "#1E1E1E" }} />

            {/* Features */}
            <ul className="space-y-2.5 mb-5 flex-1">
              {[
                { text: "Unlimited team members", highlight: false },
                { text: "Unlimited projects", highlight: false },
                { text: "All integrations", highlight: false },
                { text: "Voice control", highlight: false },
                { text: "Web search", highlight: false },
                { text: "Full template library", highlight: false },
                { text: "Unlimited chat history", highlight: false },
                { text: "Activity log", highlight: false },
                { text: "Advanced admin controls", highlight: false },
                { text: "Dedicated support", highlight: false },
                { text: "Custom onboarding", highlight: false },
              ].map((feature, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span
                    className="mt-[7px] flex-shrink-0 rounded-full"
                    style={{
                      width: 5,
                      height: 5,
                      background: feature.highlight ? "#2DB87A" : "#555555",
                    }}
                  />
                  <span
                    className={
                      feature.highlight ? t.colors.text : t.colors.textMuted
                    }
                  >
                    {feature.text}
                  </span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <button
              className={`w-full py-2 ${t.borderRadius} text-sm font-medium transition-all duration-150`}
              style={{ background: "#2DB87A", color: "#FFFFFF" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#1a9e63";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#2DB87A";
              }}
              onClick={() => {
                import("@tauri-apps/plugin-opener")
                  .then(({ open }) => open("https://omnirun.com/enterprise"))
                  .catch(() => {});
              }}
            >
              Contact Sales
            </button>
          </div>
        )}
      </div>

      {/* BYOK notice */}
      <div
        className={`${t.borderRadius} p-4`}
        style={{
          background: "rgba(59, 130, 246, 0.06)",
          border: "1px solid rgba(59, 130, 246, 0.12)",
        }}
      >
        <p className="text-sm font-medium mb-1">Bring Your Own Keys (BYOK)</p>
        <p className={`text-xs ${t.colors.textMuted} leading-relaxed`}>
          Your subscription covers the omnirun app. AI usage is billed
          separately by your provider (Anthropic, OpenAI, etc.) — Set up your API keys in{" "}
          <button
            className="text-blue-400 hover:underline"
            onClick={() => {
              // Navigate to API key settings
            }}
          >
            Settings → API Keys
          </button>
          .
        </p>
      </div>
    </div>
  );
}

export default BillingSettings;