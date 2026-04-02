// ============================================================
// AboutMePanel.tsx
// ============================================================
// Panel in the Assistant section that shows what the AI knows
// about the user. Two modes:
// - Card view: structured sections, easy to scan
// - Raw edit: full text editor for power users
//
// Reads from and writes to the user_memory SQLite table
// via memoryService.

import { useState, useEffect, useRef } from 'react';
import { Pencil, FileText, Save, RotateCcw, Loader2 } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { themes } from '../../config/themes';
import { loadUserContext, saveUserContext } from '../../services/memoryService';

interface AboutMePanelProps {
  onClose: () => void;
}

function AboutMePanel({ onClose }: AboutMePanelProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const [context, setContext] = useState('');
  const [editText, setEditText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load context on mount
  useEffect(() => {
    async function load() {
      try {
        const text = await loadUserContext();
        setContext(text);
        setEditText(text);
      } catch (err) {
        console.error('[AboutMePanel] Failed to load context:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Track changes
  useEffect(() => {
    setHasChanges(editText !== context);
  }, [editText, context]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editMode && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editMode]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveUserContext(editText);
      setContext(editText);
      setHasChanges(false);
    } catch (err) {
      console.error('[AboutMePanel] Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setEditText(context);
    setHasChanges(false);
  };

  // Parse sections from markdown context
  const parseSections = (text: string): { title: string; content: string }[] => {
    const sections: { title: string; content: string }[] = [];
    const lines = text.split('\n');
    let currentTitle = '';
    let currentContent: string[] = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (currentTitle) {
          sections.push({ title: currentTitle, content: currentContent.join('\n').trim() });
        }
        currentTitle = line.replace('## ', '').trim();
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }
    if (currentTitle) {
      sections.push({ title: currentTitle, content: currentContent.join('\n').trim() });
    }

    return sections;
  };

  const sections = parseSections(context);
  const isPlaceholder = (content: string) =>
    content.startsWith('[') && content.endsWith(']');

  if (loading) {
    return (
      <div className={`flex-1 flex items-center justify-center ${t.colors.bg}`}>
        <Loader2 size={20} className={`${t.colors.textMuted} animate-spin`} />
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${t.colors.bg}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 ${t.colors.bgSecondary} ${t.colors.border} border-b flex-shrink-0`}>
        <span className={`text-sm ${t.colors.textMuted}`}>
          What your assistant knows about you
        </span>
        <div className="flex items-center gap-2">
          {/* Toggle edit mode */}
          <button
            onClick={() => setEditMode(!editMode)}
            className={`p-1.5 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
            title={editMode ? 'Card view' : 'Edit raw'}
          >
            {editMode ? <FileText size={16} /> : <Pencil size={16} />}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {editMode ? (
          /* ── Raw edit mode ─────────────────────────────── */
          <div className="flex flex-col h-full">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className={`flex-1 w-full ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none`}
              style={{ minHeight: 300 }}
              spellCheck={false}
            />

            {/* Save / discard bar */}
            {hasChanges && (
              <div className={`flex items-center gap-2 mt-3 pt-3 ${t.colors.border} border-t`}>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={`px-3 py-1.5 text-sm ${t.borderRadius} bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-1.5`}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save
                </button>
                <button
                  onClick={handleDiscard}
                  disabled={saving}
                  className={`px-3 py-1.5 text-sm ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} hover:bg-white/10 transition-colors flex items-center gap-1.5`}
                >
                  <RotateCcw size={14} />
                  Discard
                </button>
                <span className={`text-xs ${t.colors.textMuted} ml-auto`}>Unsaved changes</span>
              </div>
            )}
          </div>
        ) : (
          /* ── Card view ─────────────────────────────────── */
          <div className="space-y-4 max-w-lg">
            {sections.length === 0 ? (
              <p className={`text-sm ${t.colors.textMuted}`}>
                No information yet. As you use Omnirun, it will learn about your preferences and work style.
              </p>
            ) : (
              sections.map((section) => (
                <div
                  key={section.title}
                  className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} p-3`}
                >
                  <h3 className={`text-xs font-medium uppercase tracking-wider mb-1.5 ${t.colors.textMuted}`}>
                    {section.title}
                  </h3>
                  <p
                    className={`text-sm leading-relaxed whitespace-pre-wrap ${
                      isPlaceholder(section.content) ? t.colors.textMuted + ' italic' : t.colors.text
                    }`}
                  >
                    {section.content || '—'}
                  </p>
                </div>
              ))
            )}

            <p className={`text-xs ${t.colors.textMuted} pt-2`}>
              This is what your assistant knows about you. Click the edit icon to modify it directly.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default AboutMePanel;