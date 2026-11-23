import { useEffect } from 'react';

/**
 * Returns focus to the control that opened a dialog rendered without an HDS trigger, so keyboard
 * users keep their place. When that control is gone (for example a deleted row or card), focus
 * moves to the element with `fallbackId` instead, if one is given.
 */
export function useRestoreFocus(fallbackId?: string) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
        else if (fallbackId) document.getElementById(fallbackId)?.focus();
      });
    };
  }, [fallbackId]);
}

/** Mounts alongside a conditionally rendered dialog to restore focus when it closes. */
export function RestoreFocus({ fallbackId }: { fallbackId?: string }) {
  useRestoreFocus(fallbackId);
  return null;
}
