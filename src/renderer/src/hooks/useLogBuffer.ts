import { useCallback, useState } from 'react';

export function useLogBuffer(limit = 500) {
  const [lines, setLines] = useState<string[]>([]);

  const push = useCallback(
    (message: string) => {
      setLines((previous) => {
        const next = [...previous, message];
        if (next.length <= limit) {
          return next;
        }
        return next.slice(next.length - limit);
      });
    },
    [limit],
  );

  const clear = useCallback(() => {
    setLines([]);
  }, []);

  return { lines, push, clear } as const;
}
