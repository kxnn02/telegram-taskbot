import { redirect } from "next/navigation";

/**
 * Devie's own `app/page.tsx` is a three-line `redirect("/dashboard")`
 * (issue #124 stage S4, build 4).
 */
export default async function RootPage() {
  redirect("/dashboard");
}
