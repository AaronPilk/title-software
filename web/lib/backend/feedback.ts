import type { Page } from "../title/model";

export type FeedbackKind = "problem" | "idea" | "question";
export type FeedbackStatus = "new" | "in_progress" | "done";
export type FeedbackView = "agency" | "production" | "partner";
export type FeedbackCursor = { createdAt: string; id: string };
export type FeedbackItem = {
  id: string;
  workspace_id: string;
  author_id: string;
  author_email: string;
  kind: FeedbackKind;
  message: string;
  page: Page;
  view: FeedbackView;
  status: FeedbackStatus;
  owner_reply: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type FeedbackPage = { items: FeedbackItem[]; nextCursor: FeedbackCursor | null };
export type FeedbackSubmission = {
  workspaceId: string; id: string; kind: FeedbackKind; message: string; page: Page; view: FeedbackView;
};
export type FeedbackUpdate = {
  workspaceId: string; id: string; expectedVersion: number; status: FeedbackStatus; reply: string;
};
