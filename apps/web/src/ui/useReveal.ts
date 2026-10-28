import { type RefObject, useEffect, useRef } from 'react';

/**
 * Scrolls a message into view whenever it changes, so the answer to a tap is seen even when the
 * button that caused it is far from the message (a long form, a small screen).
 */
export function useReveal<T extends HTMLElement>(
  message: string | null,
  block: ScrollLogicalPosition = 'center',
): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (message !== null && el !== null && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block, behavior: 'smooth' });
    }
  }, [message, block]);
  return ref;
}
