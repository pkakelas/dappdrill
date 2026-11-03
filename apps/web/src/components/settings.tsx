import type { domains } from "@dappdrill/db";
import { removeDomainAction, verifyDomainAction } from "@/actions/account";
import { ActionForm } from "@/components/action-form";
import { ActionButton, Facts, Hidden, Mono, Pill, SubmitButton } from "@/components/ui";

type Domain = typeof domains.$inferSelect;

/** One input and its submit button on a line. The label is for screen readers. */
export function InlineAdd({ id, label, button, children }: { id: string; label: string; button: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {children}
      <SubmitButton>{button}</SubmitButton>
    </div>
  );
}

/** A domain in a .list: its status, and while unverified, how to verify it. */
export function DomainItem({ domain: d, removable = true }: { domain: Domain; removable?: boolean }) {
  return (
    <li>
      <div className="row">
        <span className="flex min-w-0 flex-[1_1_240px] items-center gap-3">
          <Mono className="text-body">{d.host}</Mono>
          {d.verifiedAt ? <Pill>Verified</Pill> : <Pill tone="warn">Not verified</Pill>}
        </span>
        {removable && (
          <ActionButton action={removeDomainAction} fields={{ domainId: d.id }} className="btn-xs" confirm="Remove?" aria-label={`Remove ${d.host}`}>
            Remove
          </ActionButton>
        )}
      </div>
      {!d.verifiedAt && (
        <div className="flex flex-col gap-3 px-5 pb-4">
          <p className="meta m-0">Do one of these, then press Verify:</p>
          <Facts
            items={[
              [
                "File",
                <>
                  Serve <Mono>https://{d.host}/.well-known/dappdrill.txt</Mono> containing <Mono>{d.token}</Mono>
                </>,
              ],
              [
                "DNS",
                <>
                  A TXT record on <Mono>{d.host}</Mono>: <Mono>dappdrill-verify={d.token}</Mono>
                </>,
              ],
            ]}
          />
          <ActionForm action={verifyDomainAction}>
            <Hidden fields={{ domainId: d.id }} />
            <SubmitButton className="btn-sm w-fit" pendingText="Checking…">
              Verify
            </SubmitButton>
          </ActionForm>
        </div>
      )}
    </li>
  );
}
