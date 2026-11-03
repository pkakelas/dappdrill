/** What form actions return to useActionState. `secret` is shown once (new API token, invite link). */
export type ActionResult = { error?: string; ok?: string; secret?: string } | undefined;
