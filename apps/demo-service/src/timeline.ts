export interface CausalEvent {
  event_id: string;
  parent_event_id: string | null;
}

export function orderTraceByParent<T extends CausalEvent>(events: readonly T[]): T[] {
  if (events.length === 0) return [];
  const roots = events.filter((event) => event.parent_event_id === null);
  if (roots.length !== 1) {
    throw new Error(`trace must have exactly one root event; found ${roots.length}`);
  }

  const children = new Map<string, T[]>();
  for (const event of events) {
    if (event.parent_event_id === null) continue;
    const siblings = children.get(event.parent_event_id) ?? [];
    siblings.push(event);
    children.set(event.parent_event_id, siblings);
  }

  const ordered: T[] = [roots[0]!];
  while (ordered.length < events.length) {
    const current = ordered[ordered.length - 1]!;
    const next = children.get(current.event_id) ?? [];
    if (next.length !== 1) {
      throw new Error(
        next.length === 0
          ? `trace is disconnected after event ${current.event_id}`
          : `trace branches after event ${current.event_id}; found ${next.length} children`,
      );
    }
    ordered.push(next[0]!);
  }
  return ordered;
}
