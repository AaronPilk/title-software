"use client";
import { useEffect, useState, type ComponentProps } from "react";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
type Props = { value: string | number; onCommit: (value: string) => unknown };
function useBuffer(value: string | number) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return [draft, setDraft] as const;
}
/** Keep partially typed values local. Persist a complete edit when focus leaves the field. */
export function BufferedInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & Props) {
  const [draft, setDraft] = useBuffer(value);
  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        props.onBlur?.(e);
        if (draft !== String(value)) void onCommit(draft);
      }}
    />
  );
}
export function BufferedTextarea({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & Props) {
  const [draft, setDraft] = useBuffer(value);
  return (
    <Textarea
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        props.onBlur?.(e);
        if (draft !== String(value)) void onCommit(draft);
      }}
    />
  );
}
