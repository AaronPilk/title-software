"use client";
import type { ReactNode } from "react";
import {
  Search,
  FolderOpen,
  ChevronRight,
  ArrowUpRight,
  X,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Company } from "@/lib/title/model";
export function Picker({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          return (
            <SelectItem value={v} key={v}>
              {typeof o === "string" ? o : o.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Search records…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={16} />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  const color = [
    "Active",
    "Issued",
    "Complete",
    "Ready for jacket",
    "Partner",
    "Delivered",
  ].includes(value)
    ? "green"
    : ["Needs review", "New", "Queued", "In progress"].includes(value)
      ? "blue"
      : ["Rejected", "Restricted", "High", "Needs attention"].includes(value)
        ? "amber"
        : ["Onboarding", "Internal", "Pending"].includes(value)
          ? "violet"
          : "neutral";
  return <span className={`status ${color}`}>{value}</span>;
}
export function CompanyAvatar({
  company,
  large = false,
}: {
  company: Company;
  large?: boolean;
}) {
  return (
    <span className={`company-avatar ${company.color} ${large ? "large" : ""}`}>
      {company.initials}
    </span>
  );
}
export function Empty({
  title = "No matching records",
  text = "Try a different search or filter.",
  action,
}: {
  title?: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <FolderOpen size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Segments({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (v: string) => void;
  items: string[];
}) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList className="segment-list">
        {items.map((x) => (
          <TabsTrigger key={x} value={x}>
            {x}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
export function Heading({
  title,
  description,
  children,
  eyebrow,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="metric">
      <div>
        {label}
        <ArrowUpRight size={16} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function SectionTitle({
  title,
  action,
  onClick,
}: {
  title: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action && (
        <Button variant="ghost" onClick={onClick}>
          {action}
          <ChevronRight size={15} />
        </Button>
      )}
    </div>
  );
}
export function DataTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <Table className="data-table">
      <TableHeader>
        <TableRow>
          {headers.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}
export function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field-label">
      <span>{label}</span>
      {children}
    </label>
  );
}
