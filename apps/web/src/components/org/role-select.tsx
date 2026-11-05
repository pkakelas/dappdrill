"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setMemberRoleAction } from "@/actions/organization";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

/** A member's role, changed as soon as another one is picked. */
export function RoleSelect({ orgId, memberId, role, options, label }: { orgId: string; memberId: string; role: Role; options: Role[]; label: string }) {
  const [shown, show] = useOptimistic(role);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col items-end gap-1">
      <NativeSelect
        size="sm"
        aria-label={label}
        value={shown}
        disabled={pending}
        onChange={(e) => {
          const to = e.target.value as Role;
          start(async () => {
            show(to);
            setError((await setMemberRoleAction(orgId, memberId, to)).error);
          });
        }}
      >
        {options.map((r) => (
          <NativeSelectOption key={r} value={r}>
            {ROLE_LABEL[r]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}
