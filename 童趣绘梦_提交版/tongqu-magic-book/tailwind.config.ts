import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  safelist: [
    // 主题语义色（确保动态组合场景不被清理）
    "bg-theme-bg",
    "bg-theme-surface",
    "bg-theme-primary",
    "bg-theme-secondary",
    "bg-theme-accent",
    "bg-theme-success",
    "text-theme-text",
    "text-theme-text/40",
    "border-theme-text",
    // 传统色别名（组件内局部语义）
    "bg-cn-red",
    "bg-cn-yellow",
    "bg-cn-green",
    "bg-cn-azure",
    "bg-cn-paper",
    "text-cn-ink",
    "text-cn-ink/50",
    "text-cn-ink/70",
    "border-cn-ink",
    "border-cn-ink/10",
    "border-cn-ink/30",
    "border-cn-ink/40",
  ],
  theme: {
    extend: {
      colors: {
        // 语义化主题色：可通过 CSS 变量一键换肤
        "theme-bg": "rgb(var(--theme-bg) / <alpha-value>)",
        "theme-surface": "rgb(var(--theme-surface) / <alpha-value>)",
        "theme-text": "rgb(var(--theme-text) / <alpha-value>)",
        "theme-primary": "rgb(var(--theme-primary) / <alpha-value>)",
        "theme-secondary": "rgb(var(--theme-secondary) / <alpha-value>)",
        "theme-accent": "rgb(var(--theme-accent) / <alpha-value>)",
        "theme-success": "rgb(var(--theme-success) / <alpha-value>)",
        // 保留传统色别名，便于局部表达文化语义
        "cn-red": "rgb(var(--cn-red) / <alpha-value>)",
        "cn-yellow": "rgb(var(--cn-yellow) / <alpha-value>)",
        "cn-green": "rgb(var(--cn-green) / <alpha-value>)",
        "cn-azure": "rgb(var(--cn-azure) / <alpha-value>)",
        "cn-paper": "rgb(var(--cn-paper) / <alpha-value>)",
        "cn-ink": "rgb(var(--cn-ink) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        playful: ["var(--font-classical)", "var(--font-sans)", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        handdrawn: ["var(--font-classical)", "var(--font-sans)", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        classical: ["var(--font-classical)", "serif"],
      },
      boxShadow: {
        soft: "0 12px 28px rgba(26, 43, 60, 0.08)",
        kid: "4px 6px 0px rgba(26, 43, 60, 1)",
        "kid-hover": "2px 4px 0px rgba(26, 43, 60, 1)",
        "kid-active": "0px 0px 0px rgba(26, 43, 60, 1)",
      },
      screens: {
        ipad: "1024px",
      },
      backgroundImage: {
        "paper-texture": "url(\"data:image/svg+xml,%3Csvg width='200' height='200' viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E\")"
      }
    },
  },
  plugins: [],
} satisfies Config;
