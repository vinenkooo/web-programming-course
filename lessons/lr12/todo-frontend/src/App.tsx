import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNetworkStatus } from './pwa/network-status';
import { pushQueue, QueueAction, readQueue } from './pwa/queue';
import { syncQueue } from './pwa/sync';

type ServerTodo = {
  id: number;
  title: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
};

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function toLocalText(value: string) {
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('ru-RU');
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function apiFetchTodos(): Promise<ServerTodo[]> {
  const response = await fetch(`${API_BASE_URL}/api/todos`);
  const data = await parseJson<{ items: ServerTodo[] }>(response);
  return data.items;
}

async function apiCreate(title: string): Promise<ServerTodo> {
  const response = await fetch(`${API_BASE_URL}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  return parseJson<ServerTodo>(response);
}

async function apiToggle(todoId: number, done: boolean): Promise<ServerTodo> {
  return apiUpdate(todoId, { done });
}

async function apiUpdate(todoId: number, patch: { title?: string; done?: boolean }): Promise<ServerTodo> {
  const response = await fetch(`${API_BASE_URL}/api/todos/${todoId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  return parseJson<ServerTodo>(response);
}

async function apiDelete(todoId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/todos/${todoId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

type SyncStatus = 'idle' | 'syncing' | 'error';

export default function App() {
  const [todos, setTodos] = useState<ServerTodo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<string>('');
  const [inputValue, setInputValue] = useState<string>('');
  const [queueActions, setQueueActions] = useState<QueueAction[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const isOnline = useNetworkStatus();

  const refreshFromServer = useCallback(async () => {
    const serverTodos = await apiFetchTodos();
    setTodos(serverTodos);
  }, []);

  const updateQueueState = useCallback(() => {
    setQueueActions(readQueue());
  }, []);

  const runSync = useCallback(async () => {
    setSyncStatus('syncing');

    try {
      const restCount = await syncQueue();
      updateQueueState();
      await refreshFromServer();

      if (restCount === 0) {
        setSyncStatus('idle');
        setMessage('Синхронизация завершена.');
        return;
      }

      setSyncStatus('error');
      setMessage('Не все операции удалось синхронизировать. Повторите позже.');
    } catch {
      updateQueueState();
      setSyncStatus('error');
      setMessage('Синхронизация завершилась с ошибкой.');
    }
  }, [refreshFromServer, updateQueueState]);

  const onCreate = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      const action = { type: 'create', payload: { title: trimmed } } as const;

      if (!navigator.onLine) {
        pushQueue(action);
        updateQueueState();
        setMessage('Нет сети. Действие сохранено в локальную очередь.');
        return;
      }

      try {
        await apiCreate(trimmed);
        await refreshFromServer();
        setMessage('Задача добавлена.');
      } catch {
        pushQueue(action);
        updateQueueState();
        setMessage('Не удалось отправить запрос. Действие сохранено в локальную очередь.');
      }
    },
    [refreshFromServer, updateQueueState]
  );

  const onToggle = useCallback(
    async (todo: ServerTodo) => {
      const action = { type: 'update', payload: { id: todo.id, done: !todo.done } } as const;

      if (!navigator.onLine) {
        pushQueue(action);
        updateQueueState();
        setMessage('Нет сети. Действие сохранено в локальную очередь.');
        return;
      }

      try {
        await apiToggle(todo.id, !todo.done);
        await refreshFromServer();
        setMessage('Статус обновлен.');
      } catch {
        pushQueue(action);
        updateQueueState();
        setMessage('Не удалось отправить запрос. Действие сохранено в локальную очередь.');
      }
    },
    [refreshFromServer, updateQueueState]
  );

  const onDelete = useCallback(
    async (todo: ServerTodo) => {
      const action = { type: 'delete', payload: { id: todo.id } } as const;

      if (!navigator.onLine) {
        pushQueue(action);
        updateQueueState();
        setMessage('Нет сети. Действие сохранено в локальную очередь.');
        return;
      }

      try {
        await apiDelete(todo.id);
        await refreshFromServer();
        setMessage('Задача удалена.');
      } catch {
        pushQueue(action);
        updateQueueState();
        setMessage('Не удалось отправить запрос. Действие сохранено в локальную очередь.');
      }
    },
    [refreshFromServer, updateQueueState]
  );

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = inputValue;
      setInputValue('');
      await onCreate(value);
    },
    [inputValue, onCreate]
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      updateQueueState();

      try {
        await refreshFromServer();
      } catch {
        if (!cancelled) {
          setMessage('Не удалось загрузить данные. Проверьте, что backend запущен.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [refreshFromServer, updateQueueState]);

  useEffect(() => {
    if (!isOnline || readQueue().length === 0) {
      return;
    }

    void runSync();
  }, [isOnline, runSync]);

  return (
    <main className="app">
      <header className="header">
        <h1>Todo-сы</h1>
        <span className={`badge ${isOnline ? 'online' : 'offline'}`}>{isOnline ? 'online' : 'offline'}</span>
      </header>

      <p className="muted">
        Есть: online CRUD. Реализовать: PWA, offline-очередь и синхронизацию после reconnect.
      </p>

      <form className="toolbar" onSubmit={onSubmit}>
        <input
          type="text"
          maxLength={200}
          placeholder="Новая задача"
          required
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
        />
        <button type="submit">Добавить</button>
        <button type="button" onClick={() => void runSync()} disabled={queueActions.length === 0 || syncStatus === 'syncing'}>
          {syncStatus === 'syncing' ? 'Синхронизация...' : 'Синхронизировать'}
        </button>
      </form>

      <section className="meta">
        <span className="badge">Офлайн-очередь: {queueActions.length}</span>
        <span className={`badge ${syncStatus === 'error' ? 'error' : syncStatus === 'syncing' ? 'syncing' : ''}`}>
          sync: {syncStatus}
        </span>
      </section>

      <section className="todo-note">
        <p>Операции сохраняются в локальную очередь и автоматически отправляются после события <code>online</code>.</p>
      </section>

      {message ? <div className="message">{message}</div> : null}
      {isLoading ? <p>Загрузка...</p> : null}
      {!isLoading && todos.length === 0 ? <div className="empty">Пока нет задач</div> : null}

      <ul className="list">
        {todos.map((todo) => (
          <li className="item" key={todo.id}>
            <button type="button" onClick={() => void onToggle(todo)}>
              {todo.done ? '✅' : '⬜'}
            </button>
            <div>
              <div className={todo.done ? 'done' : ''}>{todo.title}</div>
              <div className="hint">Сервер · {toLocalText(todo.updatedAt)}</div>
            </div>
            <button type="button" onClick={() => void onDelete(todo)}>
              Удалить
            </button>
            <span className="hint">#{todo.id}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
