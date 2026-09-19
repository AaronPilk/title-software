"use client";
import { Button } from "@/components/ui/button";
import { Picker } from "./shared";
import { chooseStaffAssignment, useStaffDirectory } from "./use-staff-directory";

type AssignmentFieldProps = {
  owner: string;
  assigneeId?: string;
  label: string;
  emptyLabel?: string;
  onChange: (assignment: { owner: string; assigneeId?: string }) => void;
};

export function StaffAssignmentPicker({ companyId, kind = "task", ...props }: AssignmentFieldProps & {
  companyId: string;
  kind?: "task" | "order";
}) {
  const directory = useStaffDirectory(companyId, kind);
  return <StaffAssignmentField {...props} directory={directory} />;
}

/** Forms that validate a selection share this exact directory with the field. */
export function StaffAssignmentField({ directory, owner, assigneeId, label, emptyLabel, onChange }: AssignmentFieldProps & {
  directory: ReturnType<typeof useStaffDirectory>;
}) {
  const { staff, loading, error, refresh } = directory;
  const matching = staff.find(member => assigneeId ? member.userId === assigneeId : (member.userId === owner || member.email.toLowerCase() === owner.toLowerCase()));
  return <div>
    <Picker label={label} value={matching?.userId || "__existing"}
      disabled={loading || !!error || !staff.length}
      options={[
        ...(!matching ? [{ value: "__existing", label: !owner && emptyLabel ? emptyLabel : `${owner || "Unassigned"} · existing assignment` }] : []),
        ...staff.map(member => ({ value: member.userId, label: member.label })),
      ]}
      onChange={value => { if (value !== "__existing") onChange(chooseStaffAssignment(staff, value)); }} />
    {loading && <small className="subtle">Loading staff…</small>}
    {error && <p className="form-note">{error} <Button type="button" variant="link" onClick={refresh}>Refresh staff</Button></p>}
    {!loading && !error && !staff.length && <p className="form-note">No available staff for this company. <Button type="button" variant="link" onClick={refresh}>Refresh staff</Button></p>}
  </div>;
}
