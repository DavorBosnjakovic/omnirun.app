// ============================================================
// MemorySettings.tsx
// ============================================================
// Settings page for the memory system.
// Three learning toggles (all default ON) + sync toggle (default OFF).

import { useState, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { themes } from '../../config/themes';
import { Brain, MessageSquare, Code2, Pen, Cloud, CloudOff, Loader2, Trash2 } from 'lucide-react';
import { getMemorySettings, saveMemorySettings, loadUserContext, saveUserContext, compressMemory, type MemorySettings as MemorySettingsType } from '../../services/memoryService';
import { dbService } from '../../services/dbService';

function MemorySettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const [settings, setSettings] = useState<MemorySettingsType>({
    learnAssistant: true,
    learnProjects: true,
    learnVoice: true,
    syncEnabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [observationCount, setObservationCount] = useState(0);
  const [contextLength, setContextLength] = useState(0);

  // Load settings and stats on mount
  useEffect(() => {
    async function load() {
      try {
        const s = await getMemorySettings();
        setSettings(s);

        const count = await dbService.getMemoryObservationCount();
        setObservationCount(count);

        const context = await loadUserContext();
        // Rough token estimate: ~4 chars per token
        setContextLength(Math.round(context.length / 4));
      } catch (err) {
        console.error('[MemorySettings] Failed to load:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleToggle = async (key: keyof MemorySettingsType, value: boolean) => {
    // Sync toggle needs confirmation
    if (key === 'syncEnabled' && value) {
      setSyncConfirmOpen(true);
      return;
    }

    const updated = { ...settings, [key]: value };
    setSettings(updated);
    setSaving(true);
    try {
      await saveMemorySettings(updated);
    } catch (err) {
      console.error('[MemorySettings] Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncConfirm = async () => {
    setSyncConfirmOpen(false);
    const updated = { ...settings, syncEnabled: true };
    setSettings(updated);
    setSaving(true);
    try {
      await saveMemorySettings(updated);
    } catch (err) {
      console.error('[MemorySettings] Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClearMemory = async () => {
    if (!window.confirm('This will erase everything Omnirun has learned about you. Your context file and all observations will be deleted. This cannot be undone.\n\nAre you sure?')) return;

    setSaving(true);
    try {
      await saveUserContext('');
      await dbService.clearAllMemoryObservations();
      setObservationCount(0);
      setContextLength(0);
    } catch (err) {
      console.error('[MemorySettings] Clear memory failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCompress = async () => {
    setCompressing(true);
    try {
      await compressMemory();

      // Refresh stats
      const count = await dbService.getMemoryObservationCount();
      setObservationCount(count);
      const context = await loadUserContext();
      setContextLength(Math.round(context.length / 4));
    } catch (err) {
      console.error('[MemorySettings] Compress failed:', err);
    } finally {
      setCompressing(false);
    }
  };

  if (loading) {
    return (
      <div className={`${t.colors.text} flex items-center gap-2 mt-8`}>
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Loading memory settings...</span>
      </div>
    );
  }

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-2">Memory</h1>
      <p className={`${t.colors.textMuted} mb-6`}>
        Omnirun learns from your conversations to become more helpful over time. Everything is stored locally on your device.
      </p>

      {/* Stats */}
      <div className={`flex items-center gap-4 mb-6 p-4 ${t.colors.bgSecondary} ${t.borderRadius}`}>
        <div>
          <div className={`text-xs ${t.colors.textMuted}`}>Observations</div>
          <div className="text-lg font-semibold">{observationCount}</div>
        </div>
        <div className={`w-px h-8 ${t.colors.border}`} style={{ background: 'currentColor', opacity: 0.2 }} />
        <div>
          <div className={`text-xs ${t.colors.textMuted}`}>Context size</div>
          <div className="text-lg font-semibold">
            ~{contextLength}<span className={`text-xs ${t.colors.textMuted} ml-1`}>/ 3000 tokens</span>
          </div>
        </div>
        {observationCount > 0 && (
          <>
            <div className="ml-auto">
              <button
                onClick={handleCompress}
                disabled={compressing}
                className={`${t.colors.accent} ${t.colors.accentHover} ${theme === "highContrast" ? "text-black" : "text-white"} px-4 py-2 text-sm ${t.borderRadius} disabled:opacity-50 flex items-center gap-1.5`}
              >
                {compressing ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                {compressing ? 'Compressing...' : 'Compress now'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Learning toggles */}
      <div className="space-y-5 mb-8">
        {/* Assistant conversations */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.learnAssistant}
            onChange={(e) => handleToggle('learnAssistant', e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className={t.colors.textMuted} />
              <span className="font-medium">Learn from Assistant conversations</span>
            </div>
            <p className={`text-sm mt-0.5 ${t.colors.textMuted}`}>
              The more you use it, the better it understands your habits, preferences and style. Stored locally only.
            </p>
          </div>
        </label>

        {/* Project conversations */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.learnProjects}
            onChange={(e) => handleToggle('learnProjects', e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Code2 size={16} className={t.colors.textMuted} />
              <span className="font-medium">Learn from Project conversations</span>
            </div>
            <p className={`text-sm mt-0.5 ${t.colors.textMuted}`}>
              Stores coding preferences, architectural choices, your naming conventions. Stored locally only.
            </p>
          </div>
        </label>

        {/* Writing voice */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.learnVoice}
            onChange={(e) => handleToggle('learnVoice', e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Pen size={16} className={t.colors.textMuted} />
              <span className="font-medium">Learn your writing voice</span>
            </div>
            <p className={`text-sm mt-0.5 ${t.colors.textMuted}`}>
              Used when drafting emails and content on your behalf. Stored locally only.
            </p>
          </div>
        </label>
      </div>

      {/* Sync toggle */}
      <div className="mb-8 pt-5 border-t border-gray-700">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.syncEnabled}
            onChange={(e) => handleToggle('syncEnabled', e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {settings.syncEnabled ? (
                <Cloud size={16} className={t.colors.textMuted} />
              ) : (
                <CloudOff size={16} className={t.colors.textMuted} />
              )}
              <span className="font-medium">Sync memory across devices</span>
            </div>
            <p className={`text-sm mt-0.5 ${t.colors.textMuted}`}>
              {settings.syncEnabled
                ? 'Memory is encrypted and synced to the cloud. It works across all your installations.'
                : 'Your memory is stored locally only and never leaves your device.'
              }
            </p>
          </div>
        </label>
      </div>

      {/* Clear memory */}
      <div className="pt-5 border-t border-gray-700">
        <button
          onClick={handleClearMemory}
          disabled={saving}
          className={`px-4 py-2 ${t.borderRadius} text-sm text-red-400 hover:text-red-300 ${t.colors.bgSecondary} hover:opacity-80 flex items-center gap-2`}
        >
          <Trash2 size={14} />
          Clear all memory
        </button>
        <p className={`text-xs mt-2 ${t.colors.textMuted}`}>
          Erases everything Omnirun has learned about you. Cannot be undone.
        </p>
      </div>

      {/* Sync confirmation modal */}
      {syncConfirmOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} p-6 w-96 shadow-2xl`}>
            <h3 className={`text-base font-semibold mb-3 ${t.colors.text}`}>Enable cloud sync?</h3>
            <p className={`text-sm mb-5 ${t.colors.textMuted}`}>
              Turning on sync will upload your memory to Omnirun's secure servers. It is encrypted before leaving your device, but it will no longer be local-only.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSyncConfirmOpen(false)}
                className={`px-4 py-2 text-sm ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} hover:bg-white/10 transition-colors`}
              >
                Cancel
              </button>
              <button
                onClick={handleSyncConfirm}
                className={`px-4 py-2 text-sm ${t.borderRadius} bg-blue-600 text-white hover:bg-blue-700 transition-colors`}
              >
                Sync
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MemorySettings;