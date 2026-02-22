import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

function BillingSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");

  // TODO: Replace with real plan status from license/auth system
  const currentPlan = "starter";
  const trialDaysLeft = 0; // 0 = not on trial

  const plans = [
    {
      id: "starter",
      name: "Starter",
      monthlyPrice: 39,
      annualPrice: 390,
      description: "For solo creators & indie hackers",
      badge: null,
      features: [
        { text: "1 project", highlight: false },
        { text: "3 integrations (your choice)", highlight: false },
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
      monthlyPrice: 69,
      annualPrice: 690,
      description: "For freelancers & power users",
      badge: "Most Popular",
      features: [
        { text: "5 projects", highlight: true },
        { text: "5 integrations (your choice)", highlight: false },
        { text: "Voice control", highlight: true },
        { text: "Web search", highlight: false },
        { text: "Full template library", highlight: true },
        { text: "Unlimited chat history", highlight: false },
        { text: "Email support", highlight: false },
      ],
      cta: "Upgrade to Pro",
    },
    {
      id: "business",
      name: "Business",
      monthlyPrice: 199,
      annualPrice: 1990,
      description: "For teams & agencies",
      badge: null,
      features: [
        { text: "15 projects", highlight: true },
        { text: "All integrations", highlight: true },
        { text: "Voice control", highlight: false },
        { text: "Web search", highlight: false },
        { text: "Full template library", highlight: false },
        { text: "5 team seats", highlight: true },
        { text: "Unlimited chat history", highlight: false },
        { text: "Priority email support", highlight: false },
      ],
      cta: "Upgrade to Business",
    },
  ];

  const getPrice = (plan: (typeof plans)[0]) => {
    return billingCycle === "annual" ? plan.annualPrice : plan.monthlyPrice;
  };

  const getMonthlyEquivalent = (plan: (typeof plans)[0]) => {
    if (billingCycle === "annual") {
      return Math.round(plan.annualPrice / 12);
    }
    return plan.monthlyPrice;
  };

  const getAnnualSavings = (plan: (typeof plans)[0]) => {
    return plan.monthlyPrice * 12 - plan.annualPrice;
  };

  const planIndex = (id: string) => plans.findIndex((p) => p.id === id);

  return (
    <div className={`${t.colors.text} max-w-6xl`}>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Plans & Billing</h1>
        <p className={`${t.colors.textMuted} text-sm`}>
          All plans are BYOK — you bring your own API keys and pay providers directly. No markup, full transparency.
        </p>
      </div>

      {/* Current plan status bar */}
      <div
        className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 mb-8 border ${t.colors.border}`}
      >
        <div className="flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold capitalize">{currentPlan} Plan</p>
              {trialDaysLeft > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
                  {trialDaysLeft} days left in trial
                </span>
              )}
            </div>
            <p className={`text-xs ${t.colors.textMuted} mt-0.5`}>
              Billed monthly · Renews March 4, 2026
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              className={`text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
              title="Cancel subscription"
            >
              Cancel plan
            </button>
            <button
              className={`px-3 py-1.5 ${t.borderRadius} text-sm font-medium`}
              style={{
                background: "rgba(124, 58, 237, 0.15)",
                color: "#A78BFA",
                border: "1px solid rgba(124, 58, 237, 0.3)",
              }}
            >
              Manage billing
            </button>
          </div>
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
            style={billingCycle === "monthly" ? { background: "#7C3AED" } : {}}
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
            style={billingCycle === "annual" ? { background: "#7C3AED" } : {}}
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

      {/* Plan cards — single row, all plans */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {plans.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          const isPopular = plan.badge === "Most Popular";
          const isUpgrade = planIndex(plan.id) > planIndex(currentPlan);

          return (
            <div
              key={plan.id}
              className={`relative ${t.colors.bgSecondary} ${t.borderRadius} p-5 flex flex-col transition-all duration-150`}
              style={{
                border: isPopular
                  ? "2px solid #7C3AED"
                  : isCurrent
                  ? "2px solid #2A2A2A"
                  : "1px solid #1E1E1E",
                ...(isPopular
                  ? { boxShadow: "0 0 20px rgba(124, 58, 237, 0.12)" }
                  : {}),
              }}
            >
              {/* Popular badge */}
              {isPopular && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold px-3 py-0.5 rounded-full text-white"
                  style={{ background: "#7C3AED" }}
                >
                  {plan.badge}
                </div>
              )}

              {/* Plan header — no icon */}
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
                    ${getMonthlyEquivalent(plan)}
                  </span>
                  <span className={`text-sm ${t.colors.textMuted}`}>/mo</span>
                </div>
                {billingCycle === "annual" ? (
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs ${t.colors.textMuted}`}>
                      ${getPrice(plan)}/year
                    </span>
                    <span className="text-xs text-green-400 font-medium">
                      Save ${getAnnualSavings(plan)}
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

              {/* Features — clean list, no icons */}
              <ul className="space-y-2.5 mb-5 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span
                      className="mt-[7px] flex-shrink-0 rounded-full"
                      style={{
                        width: 5,
                        height: 5,
                        background: feature.highlight ? "#7C3AED" : "#555555",
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
                  className={`w-full py-2 ${t.borderRadius} text-sm font-medium transition-all duration-150`}
                  style={
                    isPopular
                      ? { background: "#7C3AED", color: "#FFFFFF" }
                      : isUpgrade
                      ? {
                          background: "rgba(124, 58, 237, 0.12)",
                          color: "#A78BFA",
                          border: "1px solid rgba(124, 58, 237, 0.3)",
                        }
                      : {
                          background: "transparent",
                          color: "#888888",
                          border: "1px solid #2A2A2A",
                        }
                  }
                  onMouseEnter={(e) => {
                    if (isPopular) {
                      e.currentTarget.style.background = "#5B21B6";
                    } else if (isUpgrade) {
                      e.currentTarget.style.background =
                        "rgba(124, 58, 237, 0.2)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isPopular) {
                      e.currentTarget.style.background = "#7C3AED";
                    } else if (isUpgrade) {
                      e.currentTarget.style.background =
                        "rgba(124, 58, 237, 0.12)";
                    }
                  }}
                >
                  {isUpgrade ? plan.cta : "Downgrade"}
                </button>
              )}
            </div>
          );
        })}

        {/* Enterprise card — same row */}
        <div
          className={`relative ${t.colors.bgSecondary} ${t.borderRadius} p-5 flex flex-col transition-all duration-150`}
          style={{
            border: "1px solid rgba(124, 58, 237, 0.15)",
            background:
              "linear-gradient(180deg, rgba(124, 58, 237, 0.06) 0%, transparent 100%)",
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
              { text: "Unlimited projects", highlight: true },
              { text: "All integrations", highlight: true },
              { text: "Unlimited team members", highlight: true },
              { text: "Voice control", highlight: false },
              { text: "Full template library", highlight: false },
              { text: "Unlimited chat history", highlight: false },
              { text: "Dedicated support", highlight: true },
              { text: "Custom onboarding", highlight: false },
            ].map((feature, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span
                  className="mt-[7px] flex-shrink-0 rounded-full"
                  style={{
                    width: 5,
                    height: 5,
                    background: feature.highlight ? "#7C3AED" : "#555555",
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
            style={{ background: "#7C3AED", color: "#FFFFFF" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#5B21B6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#7C3AED";
            }}
            onClick={() => {
              import("@tauri-apps/plugin-opener")
                .then(({ open }) => open("https://mydevify.com/enterprise"))
                .catch(() => {});
            }}
          >
            Contact Sales
          </button>
        </div>
      </div>

      {/* Payment method */}
      <div className="mb-8">
        <h3
          className={`text-sm font-medium mb-3 ${t.colors.textMuted} uppercase tracking-wider`}
        >
          Payment Method
        </h3>
        <div
          className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 flex justify-between items-center border ${t.colors.border}`}
        >
          <div>
            <p className="font-medium text-sm">•••• •••• •••• 4242</p>
            <p className={`text-xs ${t.colors.textMuted} mt-0.5`}>
              Visa · Expires 12/28
            </p>
          </div>
          <button
            className={`px-3 py-1.5 ${t.borderRadius} text-xs font-medium transition-colors`}
            style={{ border: "1px solid #2A2A2A", color: "#888888" }}
          >
            Update
          </button>
        </div>
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
          Your subscription covers the Mydevify app. AI usage is billed
          separately by your provider (Anthropic, OpenAI, etc.) — typically
          $5–20/month for most users. Set up your API keys in{" "}
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