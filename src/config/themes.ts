export interface Theme {
  name: string;
  colors: {
    bg: string;
    bgSecondary: string;
    bgTertiary: string;
    text: string;
    textMuted: string;
    border: string;
    accent: string;
    accentHover: string;
  };
  fontFamily: string;
  borderRadius: string;
  glow: string;
  effects: string;
}

export const themes: Record<string, Theme> = {
  omnirun: {
    name: "Omnirun",
    colors: {
      bg: "bg-[#2F3238]",
      bgSecondary: "bg-[#383C43]",
      bgTertiary: "bg-[#262A2F]",
      text: "text-[#DCE0E4]",
      textMuted: "text-[#9CA3AF]",
      border: "border-[#555B63]",
      accent: "bg-[#2DB87A]",
      accentHover: "hover:bg-[#5DE8A0]",
    },
    fontFamily: "font-sora",
    borderRadius: "rounded-lg",
    glow: "",
    effects: "",
  },
  dark: {
    name: "Dark",
    colors: {
      bg: "bg-gray-900",
      bgSecondary: "bg-gray-800",
      bgTertiary: "bg-gray-950",
      text: "text-white",
      textMuted: "text-gray-400",
      border: "border-gray-700",
      accent: "bg-blue-600",
      accentHover: "hover:bg-blue-700",
    },
    fontFamily: "font-inter",
    borderRadius: "rounded",
    glow: "",
    effects: "",
  },
  light: {
    name: "Light",
    colors: {
      bg: "bg-gray-50",
      bgSecondary: "bg-white",
      bgTertiary: "bg-gray-100",
      text: "text-gray-900",
      textMuted: "text-gray-500",
      border: "border-gray-200",
      accent: "bg-blue-500",
      accentHover: "hover:bg-blue-600",
    },
    fontFamily: "font-jakarta",
    borderRadius: "rounded",
    glow: "",
    effects: "shadow-sm",
  },
  sepia: {
    name: "Sepia",
    colors: {
      bg: "bg-stone-900",
      bgSecondary: "bg-stone-800",
      bgTertiary: "bg-stone-950",
      text: "text-orange-100",
      textMuted: "text-stone-400",
      border: "border-stone-700",
      accent: "bg-orange-700",
      accentHover: "hover:bg-orange-600",
    },
    fontFamily: "font-lora",
    borderRadius: "rounded-lg",
    glow: "",
    effects: "",
  },
  retro: {
    name: "Retro",
    colors: {
      bg: "bg-black",
      bgSecondary: "bg-black",
      bgTertiary: "bg-green-950",
      text: "text-green-400",
      textMuted: "text-green-600",
      border: "border-green-800",
      accent: "bg-green-700",
      accentHover: "hover:bg-green-600",
    },
    fontFamily: "font-jetbrains",
    borderRadius: "rounded-none",
    glow: "shadow-[0_0_10px_rgba(74,222,128,0.3)]",
    effects: "",
  },
  midnight: {
    name: "Midnight",
    colors: {
      bg: "bg-slate-950",
      bgSecondary: "bg-slate-900",
      bgTertiary: "bg-indigo-950",
      text: "text-slate-100",
      textMuted: "text-slate-400",
      border: "border-indigo-800",
      accent: "bg-indigo-600",
      accentHover: "hover:bg-indigo-500",
    },
    fontFamily: "font-grotesk",
    borderRadius: "rounded-lg",
    glow: "shadow-[0_0_15px_rgba(129,140,248,0.2)]",
    effects: "",
  },
  highContrast: {
    name: "High Contrast",
    colors: {
      bg: "bg-black",
      bgSecondary: "bg-black",
      bgTertiary: "bg-gray-900",
      text: "text-white",
      textMuted: "text-gray-300",
      border: "border-white",
      accent: "bg-white",
      accentHover: "hover:bg-gray-200",
    },
    fontFamily: "font-atkinson",
    borderRadius: "rounded-none",
    glow: "",
    effects: "",
  },
};

export type ThemeKey = keyof typeof themes;