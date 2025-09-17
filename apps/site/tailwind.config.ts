import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#283A6F",
        accent: "#EB1C24",
        paper: "#FAFAFA",
        ink: "#111827",
      },
    },
  },
  plugins: [],
} satisfies Config;
