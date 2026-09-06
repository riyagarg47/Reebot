import { useEffect, useState } from "react";
import { THEME_KEY } from "./api.js";

export const THEMES = [
  {
    id: "neon",
    label: "Neon Night",
    dot: "linear-gradient(135deg, #00ffd1, #ff4fd8)",
  },
  {
    id: "paper",
    label: "Paper Light",
    dot: "linear-gradient(135deg, #5548e8, #0d9488)",
  },
  {
    id: "sakura",
    label: "Sakura Blush",
    dot: "linear-gradient(135deg, #e75a7c, #b790ff)",
  },
  {
    id: "amber",
    label: "Retro Amber",
    dot: "linear-gradient(135deg, #ffb000, #ff5e13)",
  },
];

const LEGACY_THEMES = { ocean: "sakura", sunset: "amber" };

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return LEGACY_THEMES[saved] || saved || "neon";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}

export default function ThemePicker({ theme, onChange }) {
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Theme">
      {THEMES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={theme === item.id}
          title={item.label}
          aria-label={item.label}
          className={`theme-dot ${theme === item.id ? "active" : ""}`}
          style={{ background: item.dot }}
          onClick={() => onChange(item.id)}
        />
      ))}
    </div>
  );
}
