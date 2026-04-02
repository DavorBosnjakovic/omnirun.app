// ============================================================
// RoutinesPage.tsx - Routines Management Page (Tools > Routines)
// ============================================================
// Create, view, edit, and delete custom routines.
// Routines are triggered from Assistant chat with "run [name]".

import { useState, useEffect } from 'react';
import {
  ListChecks,
  Plus,
  Play,
  Trash2,
  Edit3,
  ChevronDown,
  ChevronRight,
  GripVertical,
  X,
  Check,
  Send,
  Sparkles,
  MessageSquare,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { themes } from '../../config/themes';
import {
  useRoutineStore,
  type Routine,
  type RoutineStep,
} from '../../stores/routineStore';

// --------------- Helpers ---------------

function generateStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatTimeAgo(ts: number): string {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

// --------------- Main Component ---------------

interface RoutinesPageProps {
  onSendToChat?: (message: string) => void;
}

export default function RoutinesPage({ onSendToChat }: RoutinesPageProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const { routines, isLoading, loadRoutines, addRoutine, updateRoutine, deleteRoutine } =
    useRoutineStore();

  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load routines on mount
  useEffect(() => {
    loadRoutines();
  }, []);

  const bgCard =
    theme === 'light' ? 'bg-white border border-gray-200 shadow-sm'
    : theme === 'sepia' ? 'bg-stone-800 border border-stone-700'
    : theme === 'retro' ? 'bg-black border border-green-800'
    : theme === 'midnight' ? 'bg-slate-900 border border-slate-700'
    : theme === 'highContrast' ? 'bg-black border border-white'
    : `${t.colors.bgSecondary} ${t.colors.border} border`;

  const bgInput =
    theme === 'light' ? 'bg-gray-100 border-gray-300 text-gray-900'
    : theme === 'retro' ? 'bg-black border-green-700 text-green-400 font-mono'
    : theme === 'highContrast' ? 'bg-black border-white text-white'
    : `${t.colors.bgTertiary || t.colors.bg} ${t.colors.border} ${t.colors.text}`;

  // Handle running a routine via chat
  const handleRun = (routine: Routine) => {
    if (!onSendToChat) return;
    onSendToChat(`run ${routine.name}`);
  };

  // ── Empty state ──
  if (!isLoading && routines.length === 0 && !showCreate) {
    return (
      <div className="max-w-3xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <ListChecks size={24} className={t.colors.textMuted} />
          <h1 className={`text-xl font-semibold ${t.colors.text}`}>Routines</h1>
        </div>

        <div className={`${bgCard} ${t.borderRadius} p-8 text-center mb-6`}>
          <ListChecks size={32} className={`mx-auto mb-3 ${t.colors.textMuted} opacity-40`} />
          <h2 className={`text-base font-medium ${t.colors.text} mb-2`}>
            One command, multiple actions
          </h2>
          <p className={`text-sm ${t.colors.textMuted} mb-6 max-w-md mx-auto`}>
            Create routines that run a sequence of actions with a single trigger phrase.
            Say "run good morning" in the Assistant chat and it all happens automatically.
          </p>

          {/* Examples */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto mb-6 text-left">
            {[
              { name: 'Good morning', steps: 'Check email, read calendar, weather summary' },
              { name: 'Start work', steps: 'Open project, deploy status, check tasks' },
              { name: 'End of day', steps: 'Save work, daily summary, close apps' },
              { name: 'Deploy check', steps: 'Run health check, deploy, verify live' },
            ].map((example) => (
              <div
                key={example.name}
                className={`px-3 py-2.5 ${t.borderRadius} ${t.colors.bgSecondary} ${t.colors.border} border`}
              >
                <p className={`text-xs font-medium ${t.colors.text}`}>"{example.name}"</p>
                <p className={`text-[11px] ${t.colors.textMuted} mt-0.5`}>{example.steps}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium ${t.borderRadius} ${t.colors.accent} ${
              theme === 'highContrast' ? 'text-black' : 'text-white'
            } ${t.colors.accentHover} transition-colors`}
          >
            <Plus size={14} />
            Create First Routine
          </button>
        </div>
      </div>
    );
  }

  // ── Main view ──
  return (
    <div className="max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ListChecks size={24} className={t.colors.textMuted} />
        <h1 className={`text-xl font-semibold ${t.colors.text}`}>Routines</h1>
        <span className={`text-sm ${t.colors.textMuted}`}>
          {routines.length} routine{routines.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setShowCreate(true)}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${t.borderRadius} ${t.colors.accent} ${
            theme === 'highContrast' ? 'text-black' : 'text-white'
          } ${t.colors.accentHover} transition-colors`}
        >
          <Plus size={12} />
          New Routine
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateRoutineForm
          theme={t}
          themeName={theme}
          bgCard={bgCard}
          bgInput={bgInput}
          onSave={async (data) => {
            await addRoutine(data);
            setShowCreate(false);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Routine list */}
      <div className="space-y-2">
        {routines.map((routine) => {
          const isExpanded = expandedId === routine.id;
          const isEditing = editingId === routine.id;
          const isConfirmingDelete = confirmDeleteId === routine.id;

          return (
            <div key={routine.id} className={`${bgCard} ${t.borderRadius}`}>
              {/* Collapsed row */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : routine.id)}
              >
                {isExpanded ? (
                  <ChevronDown size={14} className={t.colors.textMuted} />
                ) : (
                  <ChevronRight size={14} className={t.colors.textMuted} />
                )}

                <span className={`text-sm font-medium ${t.colors.text} flex-1`}>
                  "{routine.name}"
                </span>

                <span className={`text-xs ${t.colors.textMuted}`}>
                  {routine.steps.length} step{routine.steps.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className={`px-4 pb-4 pt-1 ${t.colors.border} border-t`}>
                  {/* Description */}
                  {routine.description && (
                    <p className={`text-sm ${t.colors.textMuted} mb-3`}>
                      {routine.description}
                    </p>
                  )}

                  {/* Steps */}
                  {isEditing ? (
                    <EditRoutineForm
                      routine={routine}
                      theme={t}
                      themeName={theme}
                      bgInput={bgInput}
                      onSave={async (updates) => {
                        await updateRoutine(routine.id, updates);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                      {routine.steps.length > 0 && (
                        <div className="mb-4">
                          <p className={`text-xs font-medium ${t.colors.textMuted} mb-2 uppercase tracking-wide`}>
                            Steps
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {routine.steps.map((step, i) => (
                              <div key={step.id} className="flex items-center gap-2">
                                <span className={`text-xs ${t.colors.textMuted} w-5 text-right`}>
                                  {i + 1}.
                                </span>
                                <span className={`text-sm ${t.colors.text}`}>
                                  {step.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* How to trigger */}
                      <div className={`flex items-center gap-2 mb-4 text-xs ${t.colors.textMuted}`}>
                        <MessageSquare size={11} />
                        <span>
                          Trigger: type <strong className={t.colors.text}>"run {routine.name}"</strong> in Assistant chat
                        </span>
                      </div>

                      {/* Meta */}
                      <div className={`flex items-center gap-4 mb-4 text-xs ${t.colors.textMuted}`}>
                        <span>Created {formatTimeAgo(routine.createdAt)}</span>
                        {routine.updatedAt !== routine.createdAt && (
                          <span>Updated {formatTimeAgo(routine.updatedAt)}</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRun(routine);
                          }}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${t.borderRadius} ${t.colors.accent} ${
                            theme === 'highContrast' ? 'text-black' : 'text-white'
                          } ${t.colors.accentHover} transition-colors`}
                        >
                          <Play size={12} />
                          Run
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(routine.id);
                          }}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${t.borderRadius} ${t.colors.border} border ${t.colors.text} hover:bg-white/10 transition-colors`}
                        >
                          <Edit3 size={12} />
                          Edit
                        </button>

                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5 ml-auto">
                            <span className="text-xs text-red-400">Delete?</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteRoutine(routine.id);
                                setConfirmDeleteId(null);
                                setExpandedId(null);
                              }}
                              className={`px-2 py-1 text-xs ${t.borderRadius} bg-red-600 text-white hover:bg-red-500 transition-colors`}
                            >
                              Yes
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(null);
                              }}
                              className={`px-2 py-1 text-xs ${t.borderRadius} ${t.colors.border} border ${t.colors.text} hover:bg-white/10 transition-colors`}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(routine.id);
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${t.borderRadius} ${t.colors.textMuted} hover:text-red-400 hover:bg-white/5 transition-colors ml-auto`}
                          >
                            <Trash2 size={12} />
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Tip */}
      {routines.length > 0 && !showCreate && (
        <div className={`mt-6 pt-5 ${t.colors.border} border-t text-center`}>
          <p className={`text-xs ${t.colors.textMuted} opacity-60`}>
            Trigger any routine by typing <strong>"run [name]"</strong> in the Assistant chat
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Create Routine Form
// ═══════════════════════════════════════════════════

function CreateRoutineForm({
  theme: t,
  themeName,
  bgCard,
  bgInput,
  onSave,
  onCancel,
}: {
  theme: any;
  themeName: string;
  bgCard: string;
  bgInput: string;
  onSave: (data: { name: string; description: string; steps: RoutineStep[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<RoutineStep[]>([
    { id: generateStepId(), name: '', action: '' },
  ]);

  const addStep = () => {
    setSteps([...steps, { id: generateStepId(), name: '', action: '' }]);
  };

  const removeStep = (id: string) => {
    if (steps.length <= 1) return;
    setSteps(steps.filter((s) => s.id !== id));
  };

  const updateStep = (id: string, field: 'name' | 'action', value: string) => {
    setSteps(steps.map((s) =>
      s.id === id ? { ...s, [field]: value } : s
    ));
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const validSteps = steps.filter((s) => s.name.trim());
    if (validSteps.length === 0) return;

    // Auto-fill action from name if not provided
    const finalSteps = validSteps.map((s) => ({
      ...s,
      name: s.name.trim(),
      action: s.action.trim() || s.name.trim(),
    }));

    onSave({ name: name.trim(), description: description.trim(), steps: finalSteps });
  };

  const canSave = name.trim() && steps.some((s) => s.name.trim());

  return (
    <div className={`${bgCard} ${t.borderRadius} p-5 mb-4`}>
      <h3 className={`text-sm font-medium ${t.colors.text} mb-4`}>New Routine</h3>

      {/* Name */}
      <div className="mb-3">
        <label className={`text-xs font-medium ${t.colors.textMuted} block mb-1`}>
          Trigger phrase
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`"good morning", "start work", "deploy check"...`}
          className={`w-full px-3 py-2 text-sm border ${t.borderRadius} outline-none focus:ring-1 focus:ring-blue-500 ${bgInput}`}
          autoFocus
        />
      </div>

      {/* Description */}
      <div className="mb-4">
        <label className={`text-xs font-medium ${t.colors.textMuted} block mb-1`}>
          Description <span className="opacity-50">(optional)</span>
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Quick summary of what this routine does"
          className={`w-full px-3 py-2 text-sm border ${t.borderRadius} outline-none focus:ring-1 focus:ring-blue-500 ${bgInput}`}
        />
      </div>

      {/* Steps */}
      <div className="mb-4">
        <label className={`text-xs font-medium ${t.colors.textMuted} block mb-2`}>
          Steps
        </label>
        <div className="flex flex-col gap-2">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-2">
              <span className={`text-xs ${t.colors.textMuted} w-5 text-right flex-shrink-0`}>
                {i + 1}.
              </span>
              <input
                type="text"
                value={step.name}
                onChange={(e) => updateStep(step.id, 'name', e.target.value)}
                placeholder={
                  i === 0 ? 'e.g. Check my email'
                  : i === 1 ? 'e.g. Read calendar'
                  : 'Next step...'
                }
                className={`flex-1 px-3 py-1.5 text-sm border ${t.borderRadius} outline-none focus:ring-1 focus:ring-blue-500 ${bgInput}`}
              />
              {steps.length > 1 && (
                <button
                  onClick={() => removeStep(step.id)}
                  className={`p-1 ${t.colors.textMuted} hover:text-red-400 transition-colors`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addStep}
          className={`flex items-center gap-1 mt-2 text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
        >
          <Plus size={12} />
          Add step
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!canSave}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium ${t.borderRadius} ${t.colors.accent} ${
            themeName === 'highContrast' ? 'text-black' : 'text-white'
          } ${t.colors.accentHover} transition-colors disabled:opacity-40`}
        >
          <Check size={12} />
          Create Routine
        </button>
        <button
          onClick={onCancel}
          className={`px-4 py-2 text-xs ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Edit Routine Form (inline)
// ═══════════════════════════════════════════════════

function EditRoutineForm({
  routine,
  theme: t,
  themeName,
  bgInput,
  onSave,
  onCancel,
}: {
  routine: Routine;
  theme: any;
  themeName: string;
  bgInput: string;
  onSave: (updates: { name: string; description: string; steps: RoutineStep[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(routine.name);
  const [description, setDescription] = useState(routine.description);
  const [steps, setSteps] = useState<RoutineStep[]>([...routine.steps]);

  const addStep = () => {
    setSteps([...steps, { id: generateStepId(), name: '', action: '' }]);
  };

  const removeStep = (id: string) => {
    if (steps.length <= 1) return;
    setSteps(steps.filter((s) => s.id !== id));
  };

  const updateStep = (id: string, value: string) => {
    setSteps(steps.map((s) =>
      s.id === id ? { ...s, name: value, action: value } : s
    ));
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const validSteps = steps.filter((s) => s.name.trim()).map((s) => ({
      ...s,
      name: s.name.trim(),
      action: s.action.trim() || s.name.trim(),
    }));
    if (validSteps.length === 0) return;
    onSave({ name: name.trim(), description: description.trim(), steps: validSteps });
  };

  return (
    <div className="mb-4">
      {/* Name */}
      <div className="mb-3">
        <label className={`text-xs font-medium ${t.colors.textMuted} block mb-1`}>
          Trigger phrase
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`w-full px-3 py-1.5 text-sm border ${t.borderRadius} outline-none focus:ring-1 focus:ring-blue-500 ${bgInput}`}
        />
      </div>

      {/* Description */}
      <div className="mb-3">
        <label className={`text-xs font-medium ${t.colors.textMuted} block mb-1`}>
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`w-full px-3 py-1.5 text-sm border ${t.borderRadius} outline-none focus:ring-1 focus:ring-blue-500 ${bgInput}`}
        />
      </div>

      {/* Steps */}
      <div className="mb-3">
        <label className={`text-xs font-medium ${t.colors.textMuted} block mb-2`}>Steps</label>
        <div className="flex flex-col gap-2">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-2">
              <span className={`text-xs ${t.colors.textMuted} w-5 text-right flex-shrink-0`}>
                {i + 1}.
              </span>
              <input
                type="text"
                value={step.name}
                onChange={(e) => updateStep(step.id, e.target.value)}
                className={`flex-1 px-3 py-1.5 text-sm border ${t.borderRadius} outline-none focus:ring-1 focus:ring-blue-500 ${bgInput}`}
              />
              {steps.length > 1 && (
                <button
                  onClick={() => removeStep(step.id)}
                  className={`p-1 ${t.colors.textMuted} hover:text-red-400 transition-colors`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addStep}
          className={`flex items-center gap-1 mt-2 text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
        >
          <Plus size={12} />
          Add step
        </button>
      </div>

      {/* Save/Cancel */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!name.trim() || !steps.some((s) => s.name.trim())}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${t.borderRadius} ${t.colors.accent} ${
            themeName === 'highContrast' ? 'text-black' : 'text-white'
          } ${t.colors.accentHover} transition-colors disabled:opacity-40`}
        >
          <Check size={12} />
          Save
        </button>
        <button
          onClick={onCancel}
          className={`px-3 py-1.5 text-xs ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}