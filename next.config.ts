import type { NextConfig } from "next";

/**
 * Next.js config for the Phase 6.1 dashboard rewrite (issue #17). The repo
 * already has a root `tsconfig.json` scoped to compiling `src/` for the bot
 * (`npm run build`/`typecheck`) — rather than repurpose it for the App
 * Router (which would risk breaking that unrelated build), this app is
 * type-checked against its own `tsconfig.next.json` (see that file's doc
 * comment), configured here.
 */
const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.next.json",
  },
  // The reused src/ modules (service layer, storage, web helpers) are
  // compiled by tsc under NodeNext module resolution, which requires every
  // relative import to carry an explicit ".js" extension even though the
  // source files are ".ts" — that's what tsconfig.json/tsconfig.api.json
  // already expect. Webpack's resolver doesn't do that ".js"->".ts"
  // rewriting on its own, so without this it can't follow those imports
  // when bundling app/ (which pulls src/ in directly, unbuilt, rather than
  // via dist/). This tells webpack to also try ".ts"/".tsx" whenever a
  // ".js" specifier doesn't resolve literally.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
