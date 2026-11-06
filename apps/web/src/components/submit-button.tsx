"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** The button of a plain `<form action>`: off, and saying what it's doing, while the action runs. */
export function SubmitButton({ busy, children, ...props }: ComponentProps<typeof Button> & { busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? busy : children}
    </Button>
  );
}
