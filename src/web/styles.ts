/**
 * The DEVCON+ stylesheet for the dashboard, lifted verbatim (tokens, CSS
 * anatomy, icon paths) from the approved design source
 * (`<scratchpad>/devcon-dashboard/lib.mjs`, itself copied from the DEVCON+
 * `colors_and_type.css` / `org.css`). Numeric values are intentionally not
 * rounded or "tidied" — they're the design system's exact values.
 *
 * Fonts are served as real files from the Next.js `public/` directory,
 * not inlined as base64 — inlining was a constraint of the design canvas
 * only (it could only reach Google Fonts, not local files) and would bloat
 * every page load here.
 */

export const FONTS = `
@font-face{font-family:'Proxima Nova';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/ProximaNova-Regular.woff2) format('woff2');}
@font-face{font-family:'Proxima Nova';font-style:normal;font-weight:600;font-display:swap;src:url(/fonts/ProximaNova-Semibold.woff2) format('woff2');}
@font-face{font-family:'Proxima Nova';font-style:normal;font-weight:700 900;font-display:swap;src:url(/fonts/ProximaNova-Bold.woff2) format('woff2');}
`;

export const TOKENS = `
:root{
  --color-primary:66 99 235;
  --primary:rgb(var(--color-primary));
  --primary-dark:#314EC7;
  --primary-tint:rgb(var(--color-primary)/0.10);
  --navy:#1E2A56; --navy-deep:#0C1330; --navy-800:#131C3D; --navy-500:#3A4D86;
  --green:#21C45D; --green-deep:#0E7A4B; --red:#EF4444; --red-deep:#C2363B;
  --slate-50:#F8FAFC; --slate-100:#F1F5F9; --slate-200:#E2E8F0; --slate-300:#CBD5E1;
  --slate-400:#94A3B8; --slate-500:#64748B; --slate-700:#334155; --slate-900:#0F172A;
  --green-bg:#DEF6EA; --green-fg:#0E7A4B;
  --red-bg:#FCE3E4; --red-fg:#C2363B;
  --gold-bg:#FEF6D6; --gold-fg:#946008;
  --blue-bg:#E4EEFE; --blue-fg:#1A5FCC;
  --bg:var(--slate-50); --surface:#FFFFFF; --surface-2:var(--slate-50); --surface-sunken:var(--slate-100);
  --fg1:var(--slate-900); --fg2:var(--slate-500); --fg3:var(--slate-400);
  --fg-on-dark-2:#B8C0DC; --fg-on-dark-3:#7E89AE;
  --border:var(--slate-200); --border-strong:var(--slate-300); --border-dark:rgba(255,255,255,0.10);
  --status-pending-bg:var(--gold-bg); --status-pending-fg:#9A6206;
  --status-approved-bg:var(--green-bg); --status-approved-fg:var(--green-deep);
  --status-rejected-bg:var(--red-bg); --status-rejected-fg:var(--red-deep);
  --status-shipped-bg:var(--blue-bg); --status-shipped-fg:var(--blue-fg);
  --font-sans:'Proxima Nova',system-ui,-apple-system,sans-serif;
  --font-mono:'IBM Plex Mono',ui-monospace,'SF Mono',monospace;
  --md3-headline-lg:700 24px/32px var(--font-sans);
  --md3-headline-sm:700 18px/26px var(--font-sans);
  --md3-title-md:600 15px/22px var(--font-sans);
  --md3-body-lg:400 15px/22px var(--font-sans);
  --md3-body-md:400 14px/20px var(--font-sans);
  --md3-body-sm:400 12px/17px var(--font-sans);
  --md3-label-lg:600 13px/18px var(--font-sans);
  --md3-label-md:600 12px/16px var(--font-sans);
  --tracking-eyebrow:0.08em; --tracking-tight:-0.02em;
  --radius-md:14px; --radius-lg:18px; --radius-pill:999px;
  --shadow-sm:0 1px 3px rgba(15,23,42,.06),0 1px 2px rgba(15,23,42,.04);
  --shadow-primary:0 8px 22px rgb(var(--color-primary)/0.30);
}`;

export const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font-sans);background:var(--bg);color:var(--fg1);-webkit-font-smoothing:antialiased}
a{color:var(--primary);text-decoration:none}
a:hover{color:var(--primary-dark)}
.app{display:flex;min-height:100vh}
.tg-login-widget iframe{border:0;background:transparent}

.sidebar{width:256px;flex:none;background:linear-gradient(185deg,var(--navy),var(--navy-deep));color:#fff;display:flex;flex-direction:column;padding:22px 16px}
.brand{display:flex;align-items:center;gap:10px;padding:4px 8px 22px}
.brand .mark{font:700 20px/26px var(--font-sans);letter-spacing:var(--tracking-tight)}
.brand .tag{font:var(--md3-body-sm);color:var(--fg-on-dark-3);margin-top:1px}
.nav-eyebrow{font:var(--md3-body-sm);letter-spacing:var(--tracking-eyebrow);text-transform:uppercase;color:var(--fg-on-dark-3);padding:14px 10px 6px}
.nav-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:var(--radius-md);color:var(--fg-on-dark-2);font:600 14px/20px var(--font-sans)}
.nav-item.active{background:var(--primary);color:#fff;box-shadow:var(--shadow-primary)}
.nav-item svg{width:20px;height:20px;flex:none}
.side-user{margin-top:auto;display:flex;align-items:center;gap:10px;padding:14px 8px 0;border-top:1px solid var(--border-dark)}
.side-user .av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--navy-500),var(--navy-800));display:flex;align-items:center;justify-content:center;font:var(--md3-label-lg);flex:none}
.side-user .un{font:600 14px/20px var(--font-sans)}
.side-user .ur{font:var(--md3-body-sm);color:var(--fg-on-dark-3)}

.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{height:68px;flex:none;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 28px}
.topbar h1{font:var(--md3-headline-lg);letter-spacing:-0.01em}
.topbar .actions{display:flex;align-items:center;gap:12px}
.content{padding:28px;flex:1;display:flex;flex-direction:column;gap:20px}

.btn{font:600 14px/20px var(--font-sans);padding:10px 16px;border-radius:var(--radius-md);border:0;display:inline-flex;align-items:center;justify-content:center;gap:7px}
.btn svg{width:17px;height:17px}
.btn.primary{background:var(--primary);color:#fff;box-shadow:var(--shadow-primary)}
.btn.secondary{background:var(--surface);color:var(--navy);box-shadow:inset 0 0 0 1.5px var(--border-strong)}
.btn.ghost{background:transparent;color:var(--fg2)}
.btn.sm{padding:7px 12px;font-size:13px}

.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);overflow:hidden}
.panel-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
.panel-head h2{font:var(--md3-headline-sm)}

table{width:100%;border-collapse:collapse}
thead th{font:var(--md3-label-md);letter-spacing:0.02em;text-transform:uppercase;color:var(--fg3);text-align:left;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--surface-2)}
tbody td{padding:14px 20px;border-bottom:1px solid var(--border);font:var(--md3-body-md);color:var(--fg1);vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
.id{font:500 13px/1.4 var(--font-mono);color:var(--fg3)}
.ttl{font:var(--md3-title-md);color:var(--fg1)}
.sub{font:var(--md3-body-sm);color:var(--fg3);margin-top:3px}
.row-actions{display:flex;gap:8px;justify-content:flex-end}

.cell-user{display:flex;align-items:center;gap:11px}
.cell-user .av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--navy-500),var(--navy-800));color:#fff;display:flex;align-items:center;justify-content:center;font:var(--md3-label-lg);flex:none}
.cell-user .av.sm{width:28px;height:28px;font:600 11px/16px var(--font-sans)}
.cell-user .nm{font:var(--md3-title-md)}
.cell-user .nm.sm{font:var(--md3-body-md);color:var(--fg2)}

.sec-head{display:flex;align-items:center;gap:12px}
.sec-ic{width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex:none}
.sec-ic svg{width:19px;height:19px}
.count{font:var(--md3-label-lg);padding:4px 12px;border-radius:var(--radius-pill)}

.seg{display:inline-flex;background:var(--surface-sunken);border-radius:var(--radius-pill);padding:3px;gap:2px}
.seg a{font:var(--md3-label-md);padding:7px 14px;border-radius:var(--radius-pill);color:var(--fg2)}
.seg a.on{background:var(--navy);color:#fff}

.badge{display:inline-flex;align-items:center;gap:6px;font:var(--md3-label-md);padding:5px 11px;border-radius:var(--radius-pill);white-space:nowrap}
.badge svg{width:13px;height:13px}
.tag{display:inline-flex;align-items:center;gap:5px;font:var(--md3-label-md);padding:4px 10px;border-radius:var(--radius-pill);background:var(--surface-sunken);color:var(--fg2);white-space:nowrap}
.tag svg{width:12px;height:12px}
.flags{display:flex;gap:6px;flex-wrap:wrap}

.chiprow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.chip{font:var(--md3-label-md);padding:7px 13px;border-radius:var(--radius-pill);background:var(--surface);color:var(--fg2);border:1px solid var(--border)}
.chip.active{background:var(--navy);color:#fff;border-color:var(--navy)}
.chip-label{font:var(--md3-label-md);color:var(--fg3);text-transform:uppercase;letter-spacing:var(--tracking-eyebrow);width:56px;flex:none}

.field{display:flex;flex-direction:column;gap:7px}
.field label{font:var(--md3-label-lg);color:var(--fg1)}
.field .hint{font:var(--md3-body-sm);color:var(--fg3)}
.input{font:var(--md3-body-lg);color:var(--fg1);background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-md);padding:12px 14px;min-height:46px;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%}
.input.placeholder{color:var(--fg3)}
.input.area{min-height:92px;align-items:flex-start}
.input input,.input select,.input textarea{border:0;outline:0;background:transparent;font:inherit;color:inherit;width:100%}
.input textarea{resize:vertical}

.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px 20px;box-shadow:var(--shadow-sm)}
.stat .ic{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center}
.stat .ic svg{width:20px;height:20px}
.stat .v{font:700 30px/38px var(--font-sans);letter-spacing:-0.01em;margin-top:12px}
.stat .k{font:var(--md3-body-md);color:var(--fg2)}

.bar{height:7px;background:var(--surface-sunken);border-radius:999px;overflow:hidden}
.bar .fill{height:100%;background:var(--primary);border-radius:999px}

.centered{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px}
.card{width:440px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);padding:32px}
`;

/** Solar-style outline icons, drawn inline (24px grid, 1.5 stroke, round
 * caps) — copied from the design source's `P` table. Inline SVG only, no
 * emoji or icon font, per the spec. */
const ICON_PATHS: Record<string, string> = {
  clipboard:
    '<path d="M9 4.5H7.5A2.5 2.5 0 0 0 5 7v11.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.5-2.5H15"/><rect x="9" y="3" width="6" height="3.5" rx="1.5"/><path d="M9 12h6M9 16h4"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V6M17 20v-9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/>',
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z"/>',
  logout:
    '<path d="M14 8V6.5A2.5 2.5 0 0 0 11.5 4h-4A2.5 2.5 0 0 0 5 6.5v11A2.5 2.5 0 0 0 7.5 20h4a2.5 2.5 0 0 0 2.5-2.5V16"/><path d="M10 12h10m0 0-3-3m3 3-3 3"/>',
  calendar: '<rect x="4" y="6" width="16" height="15" rx="2.5"/><path d="M8 3.5V7M16 3.5V7M4 11h16"/>',
  alert:
    '<path d="M12 4.8 3.6 19a1.4 1.4 0 0 0 1.2 2.1h14.4A1.4 1.4 0 0 0 20.4 19Z"/><path d="M12 10v4.2M12 17.4h.01"/>',
  arrowLeft: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  hourglass:
    '<path d="M7 3.5h10M7 20.5h10"/><path d="M8 3.5v3.2c0 1.6 4 3.6 4 5.3 0 1.7-4 3.7-4 5.3v3.2M16 3.5v3.2c0 1.6-4 3.6-4 5.3 0 1.7 4 3.7 4 5.3v3.2"/>',
  users:
    '<circle cx="9.5" cy="8.5" r="3.5"/><path d="M3.5 19.5a6 6 0 0 1 12 0"/><path d="M16 5.6a3.5 3.5 0 0 1 0 5.8M17.5 19.5a6 6 0 0 0-2-4.5"/>',
  spark: '<path d="M12 3.5 14.2 9l5.8.5-4.4 3.9 1.3 5.6L12 16.1 7.1 19l1.3-5.6L4 9.5 9.8 9Z"/>',
  chevronDown: '<path d="M7 10l5 5 5-5"/>',
};

export function icon(name: keyof typeof ICON_PATHS, size = 24): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`
  );
}

/** The four-circle DEVCON mark, from the design system's assets/logo-mark.svg. */
export const LOGO = `<svg width="40" height="24" viewBox="0 0 44 26" fill="none" style="flex:none">
<path d="M42.0896 11.0754C43.1447 11.0754 44 11.9307 44 12.9857C44 14.0408 43.1447 14.8961 42.0896 14.8961H39.0672V17.9613C39.0672 19.0872 38.1545 20 37.0285 20C35.9026 20 34.9898 19.0872 34.9898 17.9613V14.8961H31.9104C30.8553 14.8961 30 14.0408 30 12.9857C30 11.9307 30.8553 11.0754 31.9104 11.0754H34.9898V8.0387C34.9898 6.91275 35.9026 6 37.0285 6C38.1545 6 39.0672 6.91276 39.0672 8.0387V11.0754H42.0896Z" fill="white"/>
<circle cx="18.5714" cy="7.42857" r="7.42857" fill="#EA641D"/>
<circle cx="7.42857" cy="7.42857" r="7.42857" fill="#E9C902"/>
<circle cx="7.42857" cy="18.5714" r="7.42857" fill="#5C29A1"/>
<circle cx="18.5714" cy="18.5714" r="7.42857" fill="#73B209"/>
<circle cx="18.5714" cy="7.42857" r="7.42857" fill="#EA641D"/>
<path d="M12.9993 2.51733C14.1546 3.82672 14.8567 5.54503 14.8567 7.42847C14.8567 9.31163 14.1542 11.0293 12.9993 12.3386C11.8447 11.0294 11.1429 9.3113 11.1429 7.42847C11.1429 5.54536 11.8444 3.82663 12.9993 2.51733Z" fill="#E9C902"/>
</svg>`;

/** The full stylesheet content for one `<style>` tag in the shared layout. */
export const STYLESHEET = `${FONTS}\n${TOKENS}\n${CSS}\nhtml,body{height:100%}`;
