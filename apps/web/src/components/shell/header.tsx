"use client";

import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { cx, Logo } from "@/components/ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface ShellApp {
  id: string;
  name: string;
  host: string;
}

export interface ShellProps {
  apps: ShellApp[];
  lastAppId?: string;
  user: { name: string; email: string };
  org: { id: string; name: string };
  orgs: { id: string; name: string }[];
  switchOrg: (orgId: string) => Promise<void>;
}

const NAV = [
  { label: "Flows", path: "" },
  { label: "Runs", path: "/runs" },
  { label: "Settings", path: "/settings" },
];

export function Header({ apps, lastAppId, user, org, orgs, switchOrg }: ShellProps) {
  const params = useParams<{ appId?: string }>();
  const pathname = usePathname();
  // On an app's page that app is the one shown, even for the moment it isn't in this organization's list yet.
  const app = params.appId ? apps.find((a) => a.id === params.appId) : (apps.find((a) => a.id === lastAppId) ?? apps[0]);

  // Remember the app last looked at, for "/".
  useEffect(() => {
    if (params.appId) document.cookie = `dd_app=${params.appId}; path=/; max-age=31536000; samesite=lax`;
  }, [params.appId]);

  const base = params.appId ? `/apps/${params.appId}` : app ? `/apps/${app.id}` : null;
  const active = (path: string) => {
    if (!base) return false;
    if (path === "") return pathname === base || pathname.startsWith(`${base}/tests`);
    return pathname.startsWith(base + path);
  };
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  const nav = base && params.appId && (
    <nav aria-label="Main" className="flex items-center gap-1">
      {NAV.map((n) => (
        <Link
          key={n.label}
          href={base + n.path}
          aria-current={active(n.path) ? "page" : undefined}
          className={cx("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", active(n.path) ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
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
            <Button variant="ghost" size="sm" className="max-w-32 gap-1.5 px-2 sm:max-w-48" aria-label="Switch organization">
              <span className="truncate">{org.name}</span>
              <ChevronsUpDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Organizations</DropdownMenuLabel>
            {orgs.map((o) => (
              <DropdownMenuItem key={o.id} onSelect={() => o.id !== org.id && switchOrg(o.id)}>
                <span className="truncate">{o.name}</span>
                {o.id === org.id && <Check className="ml-auto" aria-label="Current" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/organization">
                <Settings /> Organization settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/organizations/new">
                <Plus /> Create organization
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span aria-hidden="true" className="-mx-2 text-muted-foreground/50 sm:-mx-4">
          /
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="max-w-32 gap-1.5 px-2 sm:max-w-56" aria-label="Switch app">
              <span className="truncate" title={app?.host}>
                {app ? app.name : params.appId ? "…" : "No apps yet"}
              </span>
              <ChevronsUpDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {apps.map((a) => (
              <DropdownMenuItem key={a.id} asChild className={cx(a.id === app?.id && "bg-accent")}>
                <Link href={`/apps/${a.id}`} className="flex flex-col items-start gap-0">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{a.host}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            {apps.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem asChild>
              <Link href="/new">
                <Plus /> Add app
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="hidden md:block">{nav}</div>

        <div className="ml-auto flex items-center gap-2">
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
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/organization">Organization settings</Link>
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
