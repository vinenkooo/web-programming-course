import { QueueAction, readQueue, writeQueue } from './queue';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

let isSyncInProgress = false;

async function sendAction(action: QueueAction): Promise<void> {
  if (action.type === 'create') {
    const response = await fetch(`${API_BASE_URL}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action.payload),
    });
    if (!response.ok) throw new Error(`create failed: ${response.status}`);
    return;
  }

  if (action.type === 'update') {
    const { id, ...rest } = action.payload;
    const response = await fetch(`${API_BASE_URL}/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rest),
    });
    if (!response.ok) throw new Error(`update failed: ${response.status}`);
    return;
  }

  const response = await fetch(`${API_BASE_URL}/api/todos/${action.payload.id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`delete failed: ${response.status}`);
}

export async function syncQueue(): Promise<number> {
  if (isSyncInProgress) return readQueue().length;
  isSyncInProgress = true;

  try {
    const queue = readQueue();
    const rest: QueueAction[] = [];

    for (let index = 0; index < queue.length; index += 1) {
      const action = queue[index];

      try {
        await sendAction(action);
      } catch {
        rest.push(...queue.slice(index));
        break;
      }
    }

    writeQueue(rest);
    return rest.length;
  } finally {
    isSyncInProgress = false;
  }
}
