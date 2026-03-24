import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "yellow-kid": "#FFD666",
        "sky-kid": "#72C8FF",
        "mint-kid": "#8CE99A",
        "grass-kid": "#69DB7C",
      },
      fontFamily: {
        playful: ["ZCOOL KuaiLe", "cursive"],
      },
      boxShadow: {
        soft: "0 12px 28px rgba(15, 23, 42, 0.12)",
        kid: "0 10px 0 rgba(15, 23, 42, 0.12), 0 15px 26px rgba(15, 23, 42, 0.18)",
      },
      screens: {
        ipad: "1024px",
      },
    },
  },
  plugins: [],
} satisfies Config;
