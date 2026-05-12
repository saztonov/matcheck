import { useEffect, useState } from 'react';
import type { HealthResponse } from '@matcheck/contracts';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as HealthResponse;
      })
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>matcheck</h1>
      <p>Портал автоматизации приёмки материалов</p>
      <section style={{ marginTop: 24 }}>
        <h2>API health</h2>
        {error ? (
          <pre style={{ color: 'crimson' }}>Ошибка: {error}</pre>
        ) : health ? (
          <pre>{JSON.stringify(health, null, 2)}</pre>
        ) : (
          <p>Загрузка…</p>
        )}
      </section>
    </main>
  );
}
