import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        zing: {
          dark: "#1e3530",
          teal: "#2a7c6f",
          "light-teal": "#95bdb6",
          cream: "#fffcf8",
        },
      },
    },
  },
  plugins: [],
};
export default config;
