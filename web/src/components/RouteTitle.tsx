import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Names the browser tab after the page's heading, so tabs, history and screen readers can tell pages apart.
// Pages load lazily, so this watches until the new heading appears.
export function RouteTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const apply = () => {
      const h1 = document.querySelector('main h1')?.textContent?.trim();
      if (h1) document.title = `${h1} · CivicPulse`;
    };
    apply();
    const obs = new MutationObserver(apply);
    const main = document.querySelector('main');
    if (main) obs.observe(main, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [pathname]);
  return null;
}
