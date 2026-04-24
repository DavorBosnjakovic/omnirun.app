import { useState, useRef, useEffect, useCallback } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAuthStore } from "../../stores/authStore";
import { getSupabase } from "../../services/supabaseClient";
import { themes, ThemeKey } from "../../config/themes";
import { Eye, EyeOff, ExternalLink, ChevronDown, Camera, Trash2, Loader2 } from "lucide-react";

// ── Reusable custom dropdown ─────────────────────────────────

interface DropdownOption {
  value: string;
  label: string;
}

interface SettingsDropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  theme: any;
}

function SettingsDropdown({ value, options, onChange, theme: t }: SettingsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label || value;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={ref} className="relative w-full max-w-xs">
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} ${t.colors.text} hover:bg-white/10 transition-colors text-left`}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          size={12}
          className={`${t.colors.textMuted} flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          className={`absolute top-full mt-1 left-0 z-50 w-full ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-xl overflow-hidden`}
        >
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center px-3 py-2 text-sm text-left transition-colors ${
                  option.value === value
                    ? "bg-blue-600/20 text-blue-300"
                    : `${t.colors.text} hover:bg-white/10`
                }`}
              >
                <span className="truncate">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Avatar Crop Modal ────────────────────────────────────────

interface AvatarCropModalProps {
  imageUrl: string;
  theme: any;
  onConfirm: (croppedBlob: Blob) => void;
  onCancel: () => void;
}

function AvatarCropModal({ imageUrl, theme: t, onConfirm, onCancel }: AvatarCropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);

  const CROP_SIZE = 200; // px, the circular preview diameter

  // Load the image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
      // Reset
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Draw the preview
  useEffect(() => {
    if (!imgLoaded || !imgRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const img = imgRef.current;
    const canvas = canvasRef.current;
    canvas.width = CROP_SIZE;
    canvas.height = CROP_SIZE;

    ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    // Calculate the scale: fit the smaller dimension to CROP_SIZE, then apply zoom
    const scale = Math.max(CROP_SIZE / img.width, CROP_SIZE / img.height) * zoom;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const drawX = (CROP_SIZE - drawW) / 2 + offset.x;
    const drawY = (CROP_SIZE - drawH) / 2 + offset.y;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();

    // Draw circular border
    ctx.beginPath();
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [imgLoaded, zoom, offset]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleConfirm = () => {
    if (!canvasRef.current) return;
    // Export the canvas as a 256x256 PNG blob
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 256;
    exportCanvas.height = 256;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx || !imgRef.current) return;

    const img = imgRef.current;
    const scale = Math.max(256 / img.width, 256 / img.height) * zoom;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const ratio = 256 / CROP_SIZE;
    const drawX = ((256 - drawW) / 2) + (offset.x * ratio);
    const drawY = ((256 - drawH) / 2) + (offset.y * ratio);

    // Clip to circle
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    exportCanvas.toBlob((blob) => {
      if (blob) onConfirm(blob);
    }, 'image/png');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} p-6 w-80 shadow-2xl`}>
        <h3 className={`text-base font-semibold mb-4 ${t.colors.text}`}>Crop Avatar</h3>

        {/* Canvas preview */}
        <div className="flex justify-center mb-4">
          <div
            ref={containerRef}
            className="relative cursor-grab active:cursor-grabbing"
            style={{ width: CROP_SIZE, height: CROP_SIZE }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <canvas
              ref={canvasRef}
              width={CROP_SIZE}
              height={CROP_SIZE}
              className="rounded-full"
            />
          </div>
        </div>

        {/* Zoom slider */}
        <div className="mb-5">
          <label className={`block text-xs mb-1.5 ${t.colors.textMuted}`}>Zoom</label>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>

        <p className={`text-xs mb-4 ${t.colors.textMuted}`}>
          Drag to reposition. This is how your avatar will look.
        </p>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className={`px-4 py-2 text-sm ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} hover:bg-white/10 transition-colors`}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 text-sm ${t.borderRadius} bg-blue-600 text-white hover:bg-blue-700 transition-colors`}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

function GeneralSettings() {
  const {
    theme, mode, timeFormat, fontSize, confirmBeforeDelete, autoSaveFiles,
    webSearchEnabled, searchApiKey,
    setTheme, setMode, setTimeFormat, setFontSize, setConfirmBeforeDelete, setAutoSaveFiles,
    setWebSearchEnabled, setSearchApiKey,
    resetToDefaults,
  } = useSettingsStore();
  const { user, profile, fetchProfile } = useAuthStore();
  const t = themes[theme];
  const [showKey, setShowKey] = useState(false);

  // Avatar state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [imgLoadError, setImgLoadError] = useState(false);

  const avatarUrl = profile?.avatar_url || null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate
    if (!file.type.startsWith('image/')) {
      setAvatarError('Please select an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5 MB.');
      return;
    }

    setAvatarError(null);
    const url = URL.createObjectURL(file);
    setCropImageUrl(url);

    // Reset the input so the same file can be re-selected
    e.target.value = '';
  };

  const handleCropConfirm = async (blob: Blob) => {
    setCropImageUrl(null);
    if (!user) return;

    setAvatarUploading(true);
    setAvatarError(null);

    try {
      const filePath = `${user.id}/avatar.png`;

      // Upload to Supabase Storage (upsert)
      const { error: uploadError } = await getSupabase()
        .storage
        .from('avatars')
        .upload(filePath, blob, {
          upsert: true,
          contentType: 'image/png',
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = getSupabase()
        .storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Add cache-buster so the browser picks up the new image
      const publicUrl = urlData.publicUrl + '?t=' + Date.now();

      // Update profile row
      const { error: updateError } = await getSupabase()
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      // Refresh profile in auth store so Topbar picks it up
      setImgLoadError(false);
      await fetchProfile();
    } catch (err: any) {
      console.error('[GeneralSettings] Avatar upload failed:', err);
      setAvatarError('Upload failed. Please try again.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleCropCancel = () => {
    if (cropImageUrl) URL.revokeObjectURL(cropImageUrl);
    setCropImageUrl(null);
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;
    if (!window.confirm('Remove your avatar?')) return;

    setAvatarUploading(true);
    setAvatarError(null);

    try {
      // Delete from storage
      await getSupabase()
        .storage
        .from('avatars')
        .remove([`${user.id}/avatar.png`]);

      // Clear profile URL
      await getSupabase()
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', user.id);

      setImgLoadError(false);
      await fetchProfile();
    } catch (err: any) {
      console.error('[GeneralSettings] Avatar removal failed:', err);
      setAvatarError('Failed to remove avatar.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const getInitials = () => {
    const name = user?.displayName || profile?.display_name || user?.email || '';
    if (!name) return '?';
    const parts = name.split(/[\s@]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  };

  const showAvatar = avatarUrl && !imgLoadError;

  const themeKeys = Object.keys(themes) as ThemeKey[];

  const themeOptions: DropdownOption[] = themeKeys.map((key) => ({
    value: key,
    label: themes[key].name,
  }));

  const modeOptions: DropdownOption[] = [
    { value: "simple", label: "Simple" },
    { value: "technical", label: "Technical" },
  ];

  const timeFormatOptions: DropdownOption[] = [
    { value: "12h", label: "12-hour (2:30 PM)" },
    { value: "24h", label: "24-hour (14:30)" },
  ];

  const fontSizeOptions: DropdownOption[] = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium (default)" },
    { value: "large", label: "Large" },
  ];

  const startupOptions: DropdownOption[] = [
    { value: "lastProject", label: "Open last project" },
    { value: "newChat", label: "Start new chat" },
    { value: "projectList", label: "Show project list" },
  ];

  const languageOptions: DropdownOption[] = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
    { value: "fr", label: "Français" },
    { value: "de", label: "Deutsch" },
  ];

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-6">General Settings</h1>

      {/* ── Avatar ──────────────────────────────────────────────── */}
      <div className="mb-6 pb-6 border-b border-gray-700">
        <label className={`block text-sm font-medium mb-3 ${t.colors.textMuted}`}>
          Profile Photo
        </label>
        <div className="flex items-center gap-4">
          {/* Circular avatar preview */}
          <div className="relative group">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-xl font-bold text-white overflow-hidden flex-shrink-0"
              style={{ background: showAvatar ? 'transparent' : 'var(--action, #7C3AED)' }}
            >
              {showAvatar ? (
                <img
                  src={avatarUrl!}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setImgLoadError(true)}
                />
              ) : (
                getInitials()
              )}
            </div>

            {/* Hover overlay */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
            >
              {avatarUploading ? (
                <Loader2 size={20} className="text-white animate-spin" />
              ) : (
                <Camera size={20} className="text-white" />
              )}
            </button>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className={`px-3 py-1.5 text-sm ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} hover:bg-white/10 transition-colors`}
              >
                {avatarUrl ? 'Change' : 'Upload'}
              </button>
              {avatarUrl && (
                <button
                  onClick={handleRemoveAvatar}
                  disabled={avatarUploading}
                  className={`px-3 py-1.5 text-sm ${t.borderRadius} text-red-400 hover:text-red-300 ${t.colors.bgTertiary} hover:bg-white/10 transition-colors flex items-center gap-1.5`}
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              )}
            </div>
            <p className={`text-xs mt-1.5 ${t.colors.textMuted}`}>
              JPG, PNG, or GIF. Max 5 MB.
            </p>
            {avatarError && (
              <p className="text-xs mt-1 text-red-400">{avatarError}</p>
            )}
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Crop modal */}
      {cropImageUrl && (
        <AvatarCropModal
          imageUrl={cropImageUrl}
          theme={t}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}

      {/* Theme selection */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Theme
        </label>
        <SettingsDropdown
          value={theme}
          options={themeOptions}
          onChange={(v) => setTheme(v as ThemeKey)}
          theme={t}
        />
      </div>

      {/* Default mode */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Default Mode
        </label>
        <SettingsDropdown
          value={mode}
          options={modeOptions}
          onChange={(v) => setMode(v as "simple" | "technical")}
          theme={t}
        />
        <p className={`text-sm mt-1 ${t.colors.textMuted}`}>
          {mode === "simple" 
            ? "Guided experience with visual previews" 
            : "Full code access with technical details"}
        </p>
      </div>

      {/* Time format */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Time Format
        </label>
        <SettingsDropdown
          value={timeFormat}
          options={timeFormatOptions}
          onChange={(v) => setTimeFormat(v as "12h" | "24h")}
          theme={t}
        />
      </div>

      {/* Chat font size */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Chat Font Size
        </label>
        <SettingsDropdown
          value={fontSize}
          options={fontSizeOptions}
          onChange={(v) => setFontSize(v as "small" | "medium" | "large")}
          theme={t}
        />
        <p className={`text-sm mt-1 ${t.colors.textMuted}`}>
          Controls the text size of chat messages
        </p>
      </div>

      {/* Auto-save */}
      <div className="mb-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSaveFiles}
            onChange={(e) => setAutoSaveFiles(e.target.checked)}
            className="w-4 h-4"
          />
          <div>
            <span className="font-medium">Auto-save files</span>
            <p className={`text-sm ${t.colors.textMuted}`}>
              Automatically save files written by AI to your project
            </p>
          </div>
        </label>
      </div>

      {/* Confirm before delete */}
      <div className="mb-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmBeforeDelete}
            onChange={(e) => setConfirmBeforeDelete(e.target.checked)}
            className="w-4 h-4"
          />
          <div>
            <span className="font-medium">Confirm before deleting</span>
            <p className={`text-sm ${t.colors.textMuted}`}>
              Ask for confirmation before deleting files or clearing chat
            </p>
          </div>
        </label>
      </div>

      {/* ── Web Search ─────────────────────────────────────────── */}
      <div className="mb-6 pt-4 border-t border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Web Search</h2>
        <p className={`text-sm mb-4 ${t.colors.textMuted}`}>
          Let the AI search the internet for documentation, solutions, and API references during conversations.
        </p>

        {/* Enable toggle */}
        <div className="mb-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={webSearchEnabled}
              onChange={(e) => setWebSearchEnabled(e.target.checked)}
              className="w-4 h-4"
            />
            <div>
              <span className="font-medium">Enable web search</span>
              <p className={`text-sm ${t.colors.textMuted}`}>
                AI can search when it needs docs, error solutions, or current info
              </p>
            </div>
          </label>
        </div>

        {/* API key input */}
        <div className="mb-2">
          <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
            Brave Search API Key
          </label>
          <div className="flex gap-2 max-w-md">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={searchApiKey}
                onChange={(e) => setSearchApiKey(e.target.value)}
                placeholder="BSA..."
                className={`w-full ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-3 py-2 pr-10 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-sm`}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 ${t.colors.textMuted} hover:${t.colors.text}`}
                title={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <p className={`text-xs mt-2 ${t.colors.textMuted}`}>
            Free: 2,000 searches/month.{" "}
            <a
              href="https://brave.com/search/api/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline hover:opacity-80"
              onClick={(e) => {
                e.preventDefault();
                import("@tauri-apps/plugin-opener").then(({ open }) => open("https://brave.com/search/api/"));
              }}
            >
              Get a free key <ExternalLink size={11} />
            </a>
          </p>
        </div>

        {/* Status indicator */}
        {webSearchEnabled && (
          <div className={`mt-3 text-xs ${searchApiKey.trim() ? "text-green-400" : "text-amber-400"}`}>
            {searchApiKey.trim()
              ? "✓ Web search is active"
              : "⚠ Add your API key above to enable search"}
          </div>
        )}
      </div>

      {/* Startup behavior */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          On Startup
        </label>
        <SettingsDropdown
          value="lastProject"
          options={startupOptions}
          onChange={() => {}}
          theme={t}
        />
      </div>

      {/* Language */}
      <div className="mb-6">
        <label className={`block text-sm font-medium mb-2 ${t.colors.textMuted}`}>
          Language
        </label>
        <SettingsDropdown
          value="en"
          options={languageOptions}
          onChange={() => {}}
          theme={t}
        />
      </div>

      {/* Reset */}
      <div className="mb-6 pt-4 border-t border-gray-700">
        <button
          onClick={() => {
            if (window.confirm("Reset all settings to defaults? This will also clear your search API key.")) {
              resetToDefaults();
            }
          }}
          className={`px-4 py-2 ${t.borderRadius} text-sm text-red-400 hover:text-red-300 ${t.colors.bgSecondary} hover:opacity-80`}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

export default GeneralSettings;