import { useAuthStore } from '../stores/auth';

// Обновляем access JWT за 60с до истечения. Это убирает 401 на интервал-driven
// запросах (sync, focus-refetch react-query): к моменту истечения у клиента
// уже лежит свежий токен. Реактивный refresh в api.ts остаётся как safety net.
const SKEW_MS = 60_000;

let timer: number | null = null;
let inFlight: Promise<string | null> | null = null;

function parseExpMs(token: string): number | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: unknown;
    };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function refreshNow(): Promise<string | null> {
  if (!inFlight) {
    inFlight = fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (r) => {
        if (!r.ok) return null;
        const j = (await r.json()) as { accessToken: string };
        return j.accessToken;
      })
      .catch(() => null)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function schedulePreemptiveRefresh(): void {
  cancelPreemptiveRefresh();
  const token = useAuthStore.getState().accessToken;
  if (!token) return;
  const expMs = parseExpMs(token);
  if (!expMs) return;
  const delay = Math.max(0, expMs - Date.now() - SKEW_MS);
  timer = window.setTimeout(async () => {
    timer = null;
    const fresh = await refreshNow();
    if (fresh) {
      // setAccessToken → подписка ниже перепланирует на новый exp.
      useAuthStore.getState().setAccessToken(fresh);
    } else {
      useAuthStore.getState().expireSession();
    }
  }, delay);
}

export function cancelPreemptiveRefresh(): void {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
}

// Авто-перепланирование при каждом изменении токена в store. Подписка
// активируется при первом импорте модуля; импорт делается в AuthProvider.tsx.
let prevToken: string | null = useAuthStore.getState().accessToken;
useAuthStore.subscribe((state) => {
  if (state.accessToken === prevToken) return;
  prevToken = state.accessToken;
  if (state.accessToken) schedulePreemptiveRefresh();
  else cancelPreemptiveRefresh();
});

// Если модуль импортирован уже после bootstrap (токен уже в store) —
// запланировать сразу.
if (prevToken) schedulePreemptiveRefresh();
