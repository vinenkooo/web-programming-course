export type QueueAction =
  | { id: string; type: 'create'; payload: { title: string }; ts: number }
  | { id: string; type: 'update'; payload: { id: number; done?: boolean; title?: string }; ts: number }
  | { id: string; type: 'delete'; payload: { id: number }; ts: number };

const QUEUE_KEY = 'offline_queue';

export function readQueue(): QueueAction[] {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueueAction[];
}

export function writeQueue(items: QueueAction[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function pushQueue(action: Omit<QueueAction, 'id' | 'ts'>) {
  const item: QueueAction = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    ...action,
  } as QueueAction;

  writeQueue([...readQueue(), item]);
}
