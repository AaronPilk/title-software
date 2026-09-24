"use client";
import type { Order } from "@/lib/title/model";
import { download } from "@/lib/title/store";
import { Button } from "@/components/ui/button";
import { finalDownloadName } from "@/lib/title/final-preparation-export";
import styles from "./field-review-history.module.css";

export function FieldReviewHistory({ order }: { order: Order }) {
  const history = order.fieldReviewHistory || [];
  if (!history.length) return null;
  return <details className={styles.history}>
    <summary>Field review history <span>{history.length} recorded actions</span></summary>
    <p>Captures, corrections and source reviews are retained here. These are recorded human actions, not independently validated training labels.</p>
    <Button variant="outline" size="sm" onClick={() => download(`${finalDownloadName(order.id)}-field-review-history.json`, JSON.stringify({ format: "titleos-field-review-history", version: 1, orderId: order.id, companyId: order.companyId, notValidatedTrainingLabels: true, events: history }, null, 2), "application/json")}>Download review history</Button>
    <ol>{history.slice(-30).reverse().map(event => <li key={event.id}>
      <div><strong>{event.label}</strong><span>{event.kind} · {new Date(event.at).toLocaleString()}</span></div>
      {event.before && event.before !== event.value && <p>Previous: <del>{event.before}</del></p>}
      {event.suggestedValue && event.suggestedValue !== event.value && <p>Suggested: {event.suggestedValue}</p>}
      <p>Recorded value: <strong>{event.value}</strong></p>
      <small>{event.by} · {event.documentId} · v{event.documentVersion} · {event.sourcePage}</small>
      {event.quote && <blockquote>{event.quote}</blockquote>}
    </li>)}</ol>
    {history.length > 30 && <p>Showing the latest 30 actions. The download contains all {history.length}.</p>}
  </details>;
}
