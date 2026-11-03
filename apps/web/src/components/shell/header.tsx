"use client";

import { ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { cx, Logo } from "@/components/common";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

  const nav = base && (
    <nav aria-label="Main" className="flex items-center gap-1">
      {NAV.map((n) => (
        <Link
          key={n.label}
          href={base + n.path}
          aria-current={active(n.path) ? "page" : undefined}
          className={cx(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active(n.path) ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="DappDrill home">
          <Logo size={18} />
          <span className="hidden font-semibold sm:inline">DappDrill</span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="max-w-[180px] gap-1.5 px-2" aria-label="Switch app">
              <span className="truncate" title={app?.host}>
                {app ? app.name : "No apps yet"}
              </span>
              <ChevronsUpDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Apps</DropdownMenuLabel>
            {apps.map((a) => (
              <DropdownMenuItem key={a.id} asChild className={cx(a.id === app?.id && "bg-accent")}>
                <Link href={`/apps/${a.id}`} className="flex flex-col items-start gap-0">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{a.host}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/new?add=1">
                <Plus /> Add app
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="hidden md:block">{nav}</div>

        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm">
            <Link href={app ? `/new?app=${app.id}` : "/new"}>New scan</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Account menu" className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs font-medium">{initial}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
                <span className="font-medium">{user.name || user.email}</span>
                <span className="text-xs text-muted-foreground">{user.email}</span>
                {app && (
                  <span className="mt-1 text-xs text-muted-foreground" title={devQuota ? "Plan limits are lifted in dev mode" : undefined}>
                    {planName} · {app.scansUsed} of {app.scansLimit} discovery scans used
                  </span>
                )}
              </DropdownMenuLabel>
              {teams.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Teams</DropdownMenuLabel>
                  {teams.map((t) => (
                    <DropdownMenuItem key={t.id} className={cx(t.id === team.id && "font-medium")} onSelect={() => switchTeam(t.id)}>
                      {t.name}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/account">Account</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  await authClient.signOut();
                  window.location.assign("/login");
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {nav && <div className="flex h-11 items-center border-t px-3 md:hidden">{nav}</div>}
    </header>
  );
}
