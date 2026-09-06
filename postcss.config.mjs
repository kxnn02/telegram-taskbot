/**
 * PostCSS config for Tailwind v4 (issue #105, sub-stage 5a). Tailwind v4
 * ships as a PostCSS plugin (`@tailwindcss/postcss`) rather than requiring
 * a `tailwind.config.js` — theme configuration lives in CSS via `@theme`
 * (see `app/globals.css`).
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
