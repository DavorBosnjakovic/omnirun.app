import { useState, useEffect, useRef, useCallback } from "react";
import { Monitor, Palette, ChevronDown, GitBranch, LogOut, Settings, Minus, Square, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { useAuthStore } from "../../stores/authStore";
import { themes, ThemeKey } from "../../config/themes";
import UsageIndicator from "../chat/UsageIndicator";
import ToolsDropdown from "./ToolsDropdown";
import elipseDark from "../../assets/elipse_transparent_dark.svg";
import elipseLight from "../../assets/elipse_transparent_light.svg";

interface TopbarProps {
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
  onToolsNavigate: (page: string) => void;
  onSettingsClick?: () => void;
}

function Topbar({ terminalOpen, onToggleTerminal, onToolsNavigate, onSettingsClick }: TopbarProps) {
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitChanges, setGitChanges] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const { theme, mode, setTheme, toggleMode } = useSettingsStore();
  const { currentProject, projectPath } = useProjectStore();
  const { user, profile, plan, logout } = useAuthStore();
  const t = themes[theme];
  const themeKeys = Object.keys(themes) as ThemeKey[];
  const isLightTheme = theme === "light";
  const elipseLogo = isLightTheme ? elipseLight : elipseDark;

  const appWindow = getCurrentWindow();

  const themeCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userMenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleThemeMouseEnter = useCallback(() => {
    if (themeCloseTimer.current) {
      clearTimeout(themeCloseTimer.current);
      themeCloseTimer.current = null;
    }
  }, []);

  const handleThemeMouseLeave = useCallback(() => {
    themeCloseTimer.current = setTimeout(() => setThemeDropdownOpen(false), 250);
  }, []);

  const handleUserMenuEnter = useCallback(() => {
    if (userMenuTimer.current) {
      clearTimeout(userMenuTimer.current);
      userMenuTimer.current = null;
    }
  }, []);

  const handleUserMenuLeave = useCallback(() => {
    userMenuTimer.current = setTimeout(() => setUserMenuOpen(false), 250);
  }, []);

  const getInitials = () => {
    const name = user?.displayName || profile?.display_name || user?.email || '';
    if (!name) return '?';
    const parts = name.split(/[\s@]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const planLabels: Record<string, string> = {
    starter: 'Starter',
    pro: 'Pro',
    business: 'Business',
    enterprise: 'Enterprise',
  };

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await logout();
  };

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };
  const handleClose = () => appWindow.close();

  useEffect(() => {
    const checkMaximized = async () => {
      setIsMaximized(await appWindow.isMaximized());
    };
    checkMaximized();

    const unlisten = appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [appWindow]);

  useEffect(() => {
    if (!projectPath || mode !== "technical") {
      setGitBranch(null);
      setGitChanges(0);
      return;
    }

    async function fetchGitStatus() {
      try {
        const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
          "execute_command",
          { command: "git rev-parse --abbrev-ref HEAD", cwd: projectPath }
        );
        if (result.exit_code === 0 && result.stdout.trim()) {
          setGitBranch(result.stdout.trim());
          const statusResult = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
            "execute_command",
            { command: "git status --porcelain", cwd: projectPath }
          );
          if (statusResult.exit_code === 0) {
            const lines = statusResult.stdout.trim().split("\n").filter((l: string) => l.length > 0);
            setGitChanges(lines.length);
          }
        } else {
          setGitBranch(null);
          setGitChanges(0);
        }
      } catch {
        setGitBranch(null);
        setGitChanges(0);
      }
    }

    fetchGitStatus();
    const interval = setInterval(fetchGitStatus, 10000);
    return () => clearInterval(interval);
  }, [projectPath, mode]);

  return (
    <div
      data-tauri-drag-region
      className={`h-14 ${t.colors.bgSecondary} ${t.colors.border} border-b flex items-center px-4 justify-between ${t.glow} select-none`}
    >
      <div className="flex items-center gap-4" data-tauri-drag-region>
        <img
          src={elipseLogo}
          alt="omnirun"
          className="h-10 w-auto flex-shrink-0"
          draggable={false}
        />
        <span className={t.colors.textMuted}>|</span>
        <span className={t.colors.textMuted} data-tauri-drag-region>
          {currentProject ? currentProject.name : "No project open"}
        </span>

        {mode === "technical" && gitBranch && (
          <>
            <span className={t.colors.textMuted}>|</span>
            <div className="flex items-center gap-1.5">
              <GitBranch size={14} className={t.colors.textMuted} />
              <span className={`text-sm ${t.colors.textMuted}`}>
                {gitBranch}
              </span>
              {gitChanges > 0 && (
                <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
                  {gitChanges}↑
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ToolsDropdown onNavigate={onToolsNavigate} />
        <UsageIndicator />

        <button
          onClick={toggleMode}
          className={`px-4 py-2 ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} text-sm flex items-center gap-2 hover:bg-white/20 transition-colors`}
        >
          <Monitor size={16} />
          {mode === "simple" ? "Simple" : "Technical"}
        </button>

        <div className="relative" onMouseEnter={handleThemeMouseEnter} onMouseLeave={handleThemeMouseLeave}>
          <button
            onClick={() => setThemeDropdownOpen(!themeDropdownOpen)}
            className={`px-4 py-2 ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} text-sm flex items-center gap-2 hover:bg-white/20 transition-colors`}
          >
            <Palette size={16} />
            {t.name}
            <ChevronDown size={14} />
          </button>
          {themeDropdownOpen && (
            <div className={`absolute right-0 mt-1 w-40 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-lg z-50`}>
              {themeKeys.map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setTheme(key);
                    setThemeDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-sm text-left flex items-center justify-between ${t.colors.text} hover:bg-white/10 transition-colors ${
                    theme === key ? t.colors.accent + " text-white" : ""
                  }`}
                >
                  {themes[key].name}
                  {theme === key && <span>✔</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {user && (
          <div className="relative" onMouseEnter={handleUserMenuEnter} onMouseLeave={handleUserMenuLeave}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white transition-all hover:ring-2 hover:ring-white/30"
              style={{ background: 'var(--action, #7C3AED)' }}
              title={user.displayName || user.email}
            >
              {getInitials()}
            </button>

            {userMenuOpen && (
              <div className={`absolute right-0 mt-1 w-64 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-lg z-50`}>
                <div className="px-3 py-3 flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: 'var(--action, #7C3AED)' }}
                  >
                    {getInitials()}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-sm font-medium ${t.colors.text} truncate`}>
                      {user.displayName || profile?.display_name || 'User'}
                    </div>
                    <div className={`text-xs ${t.colors.textMuted} truncate`}>
                      {user.email}
                    </div>
                    <span
                      className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: plan === 'starter' ? 'rgba(136,136,136,0.2)' :
                                   plan === 'pro' ? 'rgba(124,58,237,0.2)' :
                                   plan === 'business' ? 'rgba(234,179,8,0.2)' :
                                   'rgba(0,221,85,0.2)',
                        color: plan === 'starter' ? '#888888' :
                               plan === 'pro' ? '#A78BFA' :
                               plan === 'business' ? '#EAB308' :
                               '#00DD55',
                      }}
                    >
                      {planLabels[plan] || 'Starter'}
                    </span>
                  </div>
                </div>

                <div className={`${t.colors.border} border-t`} />

                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    onSettingsClick?.();
                  }}
                  className={`w-full px-3 py-2.5 text-sm text-left flex items-center gap-3 ${t.colors.text} hover:bg-white/10 transition-colors`}
                >
                  <Settings size={16} />
                  Settings
                </button>

                <div className={`${t.colors.border} border-t`} />

                <button
                  onClick={handleLogout}
                  className="w-full px-3 py-2.5 text-sm text-left flex items-center gap-3 text-red-400 hover:bg-white/10 transition-colors"
                >
                  <LogOut size={16} />
                  Log out
                </button>
              </div>
            )}
          </div>
        )}

        <div className={`w-px h-6 ${t.colors.border} mx-1`} />

        <div className="flex items-center">
          <button
            onClick={handleMinimize}
            className={`w-10 h-10 flex items-center justify-center ${t.colors.textMuted} hover:${t.colors.text} hover:bg-white/10 transition-colors rounded`}
            title="Minimize"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={handleMaximize}
            className={`w-10 h-10 flex items-center justify-center ${t.colors.textMuted} hover:${t.colors.text} hover:bg-white/10 transition-colors rounded`}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3.5" y="5" width="8" height="8" rx="1" />
                <path d="M5.5 5V3.5a1 1 0 011-1H12a1 1 0 011 1V9a1 1 0 01-1 1h-1.5" />
              </svg>
            ) : (
              <Square size={14} />
            )}
          </button>
          <button
            onClick={handleClose}
            className={`w-10 h-10 flex items-center justify-center ${t.colors.textMuted} hover:text-white hover:bg-red-600 transition-colors rounded`}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default Topbar;