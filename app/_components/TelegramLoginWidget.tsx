"use client";

import { useEffect, useRef } from "react";

/**
 * Telegram Login Widget (Phase 6.1 follow-up, issue #17). A plain JSX
 * `<script>` tag here doesn't work in the App Router: the widget script
 * injects an `<iframe>` as a sibling of itself once it loads, but that
 * `<iframe>` was never part of what the server rendered, so when React
 * hydrates the page it treats it as an unexpected node and removes it —
 * the button flashes in and immediately disappears, which looked like "no
 * button at all" during the dry-run browser test.
 *
 * Fixing this means the widget's script/iframe must live entirely outside
 * anything React hydrates against. This component renders one empty `<div>`
 * (a leaf with no children React tracks) and injects the script into it
 * imperatively from an effect, which only runs after hydration has already
 * settled — so React never sees the iframe show up mid-hydration and never
 * tries to reconcile it away.
 */
export interface TelegramLoginWidgetProps {
  botUsername: string;
  authUrl: string;
}

export function TelegramLoginWidget({ botUsername, authUrl }: TelegramLoginWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [botUsername, authUrl]);

  return <div ref={containerRef} style={{ display: "flex", justifyContent: "center" }} />;
}
