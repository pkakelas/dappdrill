/** What form actions return to useActionState. `secret` is shown once (new API token, invite link). `inline` means the form already shows this error beside its field. */
export type ActionResult = { error?: string; inline?: boolean; ok?: string; secret?: string } | undefined;
