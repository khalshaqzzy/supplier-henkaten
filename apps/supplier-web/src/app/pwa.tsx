import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

import { Button } from '@tmmin-henkaten/ui';

export function PwaLifecycle() {
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [updateReady, setUpdateReady] = useState(false);
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const update = registerSW({
        immediate: true,
        onNeedRefresh() {
          setUpdateReady(true);
        },
      });
      setApplyUpdate(() => () => update(true));
    }
    const online = () => setOffline(false);
    const disconnected = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', disconnected);
    };
  }, []);

  if (!offline && !updateReady) return null;
  return (
    <div className={`pwa-status${offline ? ' is-offline' : ''}`} role="status">
      <span>
        {offline
          ? 'Perangkat offline. Data operasional tidak dicache dan perubahan tidak akan diantrikan.'
          : 'Versi aplikasi baru siap digunakan.'}
      </span>
      {offline ? (
        <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
          Coba lagi
        </Button>
      ) : (
        <Button size="sm" onClick={() => void applyUpdate?.()}>
          Muat versi baru
        </Button>
      )}
    </div>
  );
}
