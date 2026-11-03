/** How report components link and what they may do (share pages are read-only). */
export interface ViewCtx {
  appId: string;
  /** Link to the current page with a side panel open (or closed with null). */
  panelHref: (panel: string | null) => string;
  /** Share token, for public pages: used for artifact URLs. */
  share?: string;
  readOnly: boolean;
  /** "owner/repo" when the team configured GitHub. */
  githubRepo?: string | null;
}

export function makePanelHref(path: string, query: Record<string, string | undefined>) {
  return (panel: string | null) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v && k !== "panel") q.set(k, v);
    if (panel) q.set("panel", panel);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
}
