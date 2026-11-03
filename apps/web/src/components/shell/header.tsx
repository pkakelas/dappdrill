"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect } from "react";
import { rescanAction } from "@/actions/scan";
import { authClient } from "@/lib/auth-client";
import { ActionButton, ChevronIcon, cx, Logo, Popover } from "@/components/ui";
import { Menu, MenuItem, menuLinkClass } from "./menu";

export interface ShellApp {
  id: string;
  name: string;
  host: string;
  scansUsed: number;
  scansLimit: number;
}

export interface ShellProps {
  apps: ShellApp[];
  lastAppId?: string;
  user: { name: string; email: string };
  team: { id: string; name: string };
  teams: { id: string; name: string }[];
  planName: string;
  devQuota: boolean;
  switchTeam: (teamId: string) => Promise<void>;
}

const NAV = [
  { label: "Overview", path: "" },
  { label: "Flows", path: "/flows" },
  { label: "Runs", path: "/runs" },
  { label: "Settings", path: "/settings" },
];

export function Header({ apps, lastAppId, user, team, teams, planName, devQuota, switchTeam }: ShellProps) {
  const params = useParams<{ appId?: string }>();
  const pathname = usePathname();
  const app = apps.find((a) => a.id === params.appId) ?? apps.find((a) => a.id === lastAppId) ?? apps[0];

  // Remember the app last looked at, for "/" and the Scan button.
  useEffect(() => {
    if (params.appId) document.cookie = `dd_app=${params.appId}; path=/; max-age=31536000; samesite=lax`;
  }, [params.appId]);

  const base = app ? `/apps/${app.id}` : null;
  const active = (path: string) => {
    if (!base) return false;
    if (path === "") return pathname === base;
    // Scan reports and signing reviews are runs too.
    if (path === "/runs") return ["/runs", "/scans", "/signing"].some((p) => pathname.startsWith(base + p));
    return pathname.startsWith(base + path);
  };
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 no-underline" aria-label="DappDrill home">
          <Logo size={18} />
          <span className="hidden font-serif text-[20px] tracking-[-0.02em] md:inline">DappDrill</span>
        </Link>

        <Menu
          label="Switch app"
          buttonClassName="flex h-10 max-w-[240px] cursor-pointer items-center gap-2.5 rounded-full border border-line-strong px-3.5 text-left transition-colors hover:bg-sub"
          button={
            <>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm leading-tight font-medium">{app ? app.name : "No apps yet"}</span>
                {app && <span className="truncate font-mono text-[10.5px] text-muted">{app.host}</span>}
              </span>
              <ChevronIcon className="shrink-0 text-muted" />
            </>
          }
        >
          {apps.map((a) => (
            <MenuItem key={a.id}>
              <Link href={`/apps/${a.id}`} className={cx(menuLinkClass, a.id === app?.id && "bg-sub")}>
                <span className="font-medium">{a.name}</span>
                <span className="font-mono text-xs text-muted">{a.host}</span>
              </Link>
            </MenuItem>
          ))}
          <MenuItem className="mt-1 border-t border-divide pt-1">
            <Link href="/new" className={menuLinkClass}>
              Add app
            </Link>
          </MenuItem>
        </Menu>

        {base && (
          <nav aria-label="Main" className="order-last flex w-full gap-5 md:order-none md:w-auto md:gap-6">
            {NAV.map((n) => (
              <Link
                key={n.label}
                href={base + n.path}
                aria-current={active(n.path) ? "page" : undefined}
                className={cx(
                  "border-b-2 py-2 font-mono text-[12.5px] no-underline transition-colors",
                  active(n.path) ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-3">
          {app ? (
            <Popover label={`Scan ${app.host}`} align="right" buttonClassName="btn btn-primary btn-sm h-9" button="Scan">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-body font-medium">Scan {app.host} again</span>
                  <span className="hint">Finds new flows and re-checks every edge case with your saved settings. Takes 10–15 minutes.</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <ActionButton action={rescanAction} fields={{ appId: app.id }} className="btn-primary btn-sm" pendingText="Starting…" disabled={!devQuota && app.scansUsed >= app.scansLimit}>
                    Start scan
                  </ActionButton>
                  <Link href={`/apps/${app.id}/settings`} className="btn-link">
                    Change settings
                  </Link>
                </div>
                <span className="meta">{devQuota ? "Dev mode: scans aren't counted." : `${app.scansUsed} of ${app.scansLimit} scans used this month. Replays are unlimited.`}</span>
              </div>
            </Popover>
          ) : (
            <Link href="/new" className="btn btn-primary btn-sm h-9">
              Scan
            </Link>
          )}
          <Menu
            label="Account menu"
            align="right"
            buttonClassName="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-ink font-serif text-[16px] text-paper"
            button={initial}
          >
            <div className="flex flex-col gap-0.5 border-b border-divide px-4 pt-2 pb-3">
              <span className="text-body font-medium">{user.name || user.email}</span>
              <span className="font-mono text-[11px] text-muted">{user.email}</span>
              {app && (
                <span className="mt-1.5 font-mono text-[11px] text-muted" title={devQuota ? "Plan limits are lifted in dev mode" : undefined}>
                  {planName} · {app.scansUsed} of {app.scansLimit} discovery scans used · replays unlimited
                </span>
              )}
            </div>
            {teams.length > 1 && (
              <div className="border-b border-divide py-1">
                {teams.map((t) => (
                  <MenuItem key={t.id}>
                    <button type="button" className={cx(menuLinkClass, t.id === team.id && "font-semibold")} onClick={() => switchTeam(t.id)}>
                      {t.name}
                    </button>
                  </MenuItem>
                ))}
              </div>
            )}
            <MenuItem className="pt-1">
              <Link href="/account" className={menuLinkClass}>
                Account
              </Link>
            </MenuItem>
            {devQuota && (
              <MenuItem>
                <Link href="/design" className={menuLinkClass}>
                  Design system
                </Link>
              </MenuItem>
            )}
            <MenuItem>
              <button
                type="button"
                className={menuLinkClass}
                onClick={async () => {
                  await authClient.signOut();
                  window.location.assign("/login");
                }}
              >
                Sign out
              </button>
            </MenuItem>
          </Menu>
        </div>
      </div>
    </header>
  );
}
