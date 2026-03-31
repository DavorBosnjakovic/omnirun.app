import { ExternalLink, MessageCircle } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

function AboutSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const logoSrc = theme === "light"
    ? "/logo/elipse_transparent_light.png"
    : "/logo/elipse_transparent_dark.png";

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-6">About omnirun</h1>

      <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 mb-6`}>
        <div className="flex items-center gap-4 mb-4">
          <img
            src={logoSrc}
            alt="omnirun logo"
            className="w-16 h-16 object-contain"
          />
          <div>
            <h2 className="text-xl font-semibold">omnirun</h2>
            <p className={`${t.colors.textMuted}`}>Run Everything. Describe It. Done.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className={`text-sm ${t.colors.textMuted}`}>Version</p>
            <p className="font-medium">1.0.0</p>
          </div>
          <div>
            <p className={`text-sm ${t.colors.textMuted}`}>Status</p>
            <p className="font-medium text-green-500">Up to date</p>
          </div>
        </div>
      </div>

      <h3 className={`text-sm font-medium mb-3 ${t.colors.textMuted}`}>Resources</h3>
      <div className="space-y-2 mb-6">
        <a href="https://omnirun.app/docs" target="_blank" rel="noopener noreferrer" className={`${t.colors.bgSecondary} ${t.borderRadius} p-3 flex items-center gap-3 hover:opacity-80`}>
          <ExternalLink size={18} />
          <span>Documentation</span>
        </a>
        <a href="https://discord.gg/6nah2Kup4t" target="_blank" rel="noopener noreferrer" className={`${t.colors.bgSecondary} ${t.borderRadius} p-3 flex items-center gap-3 hover:opacity-80`}>
          <MessageCircle size={18} />
          <span>Community Discord</span>
        </a>
      </div>

      <h3 className={`text-sm font-medium mb-3 ${t.colors.textMuted}`}>Support</h3>
      <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 mb-6`}>
        <p className="mb-3">Need help? We're here for you.</p>
        <div className="flex gap-2">
          <a href="mailto:support@omnirun.app" className={`${t.colors.accent} ${t.colors.accentHover} ${theme === "highContrast" ? "text-black" : "text-white"} px-4 py-2 ${t.borderRadius} inline-block`}>
            Contact Support
          </a>
          <a href="mailto:bugreports@omnirun.app" className={`${t.colors.bgTertiary} hover:opacity-80 px-4 py-2 ${t.borderRadius} inline-block`}>
            Report a Bug
          </a>
        </div>
      </div>

      <div className={`text-sm ${t.colors.textMuted}`}>
        <a href="#" className="hover:underline">Terms of Service</a>
        {" · "}
        <a href="#" className="hover:underline">Privacy Policy</a>
        {" · "}
        <a href="#" className="hover:underline">Licenses</a>
      </div>

      <p className={`text-sm ${t.colors.textMuted} mt-4`}>© 2026 omnirun. All rights reserved.</p>
    </div>
  );
}

export default AboutSettings;