import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const focusable =
  '[data-focus-initial], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export const FOCUS_HIGHLIGHT_MS = 2_600;
const RETRY_MS = 100;
const RETRY_LIMIT = 40;

/**
 * Brings the element named by the `focus` search parameter into view, highlights it briefly and
 * moves keyboard focus to its first control. Targets declare `data-focus-target="<name>"`.
 * The parameter is removed once handled so later renders and reloads do not repeat the effect.
 */
export function useFocusTarget(ready: boolean) {
  const [params, setParams] = useSearchParams();
  const focus = params.get('focus');

  useEffect(() => {
    if (!focus || !ready) return;
    let attempts = 0;
    let retry: number | undefined;
    const clear = () =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete('focus');
          return next;
        },
        { replace: true },
      );
    const apply = () => {
      const target = [...document.querySelectorAll<HTMLElement>('[data-focus-target]')].find(
        (element) => element.dataset['focusTarget'] === focus,
      );
      if (!target) {
        if (attempts++ < RETRY_LIMIT) retry = window.setTimeout(apply, RETRY_MS);
        else clear();
        return;
      }
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      target.classList.remove('is-focus-target');
      // Restart the highlight animation when the same target is requested again.
      void target.offsetWidth;
      target.classList.add('is-focus-target');
      const control =
        target.querySelector<HTMLElement>('[data-focus-initial]') ??
        (target.matches(focusable) ? target : target.querySelector<HTMLElement>(focusable));
      if (control) control.focus({ preventScroll: true });
      else {
        // A read-only destination still receives focus so keyboard and screen-reader users land
        // on the highlighted section.
        if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      window.setTimeout(() => target.classList.remove('is-focus-target'), FOCUS_HIGHLIGHT_MS);
      clear();
    };
    retry = window.setTimeout(apply, 0);
    return () => window.clearTimeout(retry);
  }, [focus, ready, setParams]);
}
