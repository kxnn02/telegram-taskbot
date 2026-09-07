import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Caller } from "../src/domain/types";
import { verifySession } from "../src/web/sessionCookie";
import { getDashboardDeps } from "../src/web/nextDashboardDeps";
import { loadOversightView } from "../src/web/oversightData";
import { Icon } from "./_components/icons";
import { DashboardShell } from "./_components/Shell";
import { Controls } from "./_components/Controls";
import { StatusChips } from "./_components/StatusChips";
import { ActionSections } from "./_components/ActionSections";
import { InternPanels } from "./_components/InternPanels";
import { MessageCard } from "./_components/MessageCard";

/**
 * The oversight view (Phase 6.1 read-only base, issue #17 — step 4; the
 * "New task" button and per-row edit/approve/revise actions restored in
 * Phase 6.2). Session check + data-fetching/filtering are delegated to
 * already-tested pure functions (`verifySession`, `loadOversightView`);
 * this Server Component is a thin render layer on top, same split as
 * `api/telegram/webhook.ts` vs `webhookHandler.ts`. Mutations themselves
 * live behind the new REST routes under `app/api/tasks/**` (ADR-0008), only
 * linked to / triggered from here.
 */

const SESSION_COOKIE = "session";

export const dynamic = "force-dynamic";

/**
 * Devie's own `app/page.tsx` is a three-line `redirect("/dashboard")`
 * (issue #124 stage S4, build 4). This repo's pre-port oversight page is
 * still deleted here rather than in this stage — S5 (#129) removes it and
 * everything it imports; this stage only changes where `/` sends you, so
 * S4 stays revertable on its own and S5's deletion stays reviewable as a
 * deletion.
 */
export default async function RootPage() {
  redirect("/dashboard");
}
