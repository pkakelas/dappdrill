"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { cx, Logo } from "@/components/ui";
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
    if (path === "") return pathname === base || pathname.startsWith(`${base}/scans`) || pathname.startsWith(`${base}/signing`);
    return pathname.startsWith(base + path);
  };
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 no-underline" aria-label="DappDrill home">
          <Logo size={24} />
          <span className="hidden text-base font-semibold tracking-[-0.01em] md:inline">DappDrill</span>
        </Link>

        <Menu
          label="Switch app"
          buttonClassName="flex max-w-[220px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-left"
          button={
            <>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold">{app ? app.name : "No apps yet"}</span>
                {app && <span className="truncate font-mono text-[11px] text-muted">{app.host}</span>}
              </span>
              <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3.5 5.5L7 9l3.5-3.5" />
              </svg>
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
            <Link href="/new?add=1" className={menuLinkClass}>
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
                  "-mb-px border-b-2 py-1.5 text-sm no-underline",
                  active(n.path) ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-3">
          {app && (
            <span className="hidden text-xs text-muted lg:inline" title={devQuota ? "Plan limits are lifted in dev mode" : undefined}>
              {app.scansUsed} of {app.scansLimit} discovery scans used · replays unlimited
            </span>
          )}
          <Link href={app ? `/new?app=${app.id}` : "/new"} className="btn btn-primary btn-sm h-9">
            Scan
          </Link>
          <Menu
            label="Account menu"
            align="right"
            buttonClassName="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-ink text-sm font-semibold text-paper"
            button={initial}
          >
            <div className="flex flex-col gap-0.5 border-b border-divide px-4 pt-2 pb-3">
              <span className="text-sm font-medium">{user.name || user.email}</span>
              <span className="text-xs text-muted">{user.email}</span>
              {app && (
                <span className="mt-1.5 text-xs text-muted">
                  {planName} · {app.scansUsed} of {app.scansLimit} discovery scans used
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
