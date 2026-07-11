import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { ApiClient } from "../api/client";
import type { MemoryRecord } from "../api/types";

export function MemoryPanel({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const [memories, setMemories] = useState<MemoryRecord[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const result = await client.getMemory();
    setMemories(result.memories);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const withBusy = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="card" aria-labelledby="memory-heading">
      <h2 id="memory-heading">{t.memory.heading}</h2>
      {memories === null ? null : memories.length === 0 ? (
        <p>{t.memory.empty}</p>
      ) : (
        <ul className="list-reset">
          {memories.map((memory) => (
            <li key={memory.id} className="memory-row">
              <span>
                <strong>{memory.key}</strong> — {t.memory.state[memory.state]}
                {memory.blocked ? ` · ${t.memory.blocked}` : ""}
              </span>
              <span className="memory-actions">
                <button
                  type="button"
                  disabled={busyId === memory.id}
                  onClick={() => {
                    const value = window.prompt(t.memory.correctPrompt);
                    if (value !== null) withBusy(memory.id, () => client.correctMemory(memory.id, value));
                  }}
                >
                  {t.memory.correct}
                </button>
                <button
                  type="button"
                  disabled={busyId === memory.id}
                  onClick={() => withBusy(memory.id, () => client.forgetMemory(memory.id))}
                >
                  {t.memory.forget}
                </button>
                <button
                  type="button"
                  disabled={busyId === memory.id}
                  onClick={() => {
                    const reason = window.prompt(t.memory.blockPrompt);
                    if (reason !== null) withBusy(memory.id, () => client.blockMemory(memory.id, reason));
                  }}
                >
                  {t.memory.block}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
