/* global self */
/**
 * Service worker (vite-plugin-pwa, injectManifest). It precaches the app shell AND the food dataset, so the
 * app can resolve foods with no network.
 *
 * Plain JavaScript on purpose: it runs in the worker scope, and the app's tsconfig is for the window scope.
 *
 * `data/meta.json` is the pointer to the current hash-named foods file, and the app fetches it with
 * `cache: 'no-cache'` so a deploy is picked up. A precache route would answer that fetch from the install-time
 * copy and defeat that, so meta.json gets its own route, registered BEFORE the precache route: network first
 * (revalidating, with a timeout), falling back to the precached copy only when the network is unreachable.
 * Online, a new dataset hash is seen at once; on a train, the last installed one is used.
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

const NETWORK_TIMEOUT_MS = 4000;

registerRoute(
  ({ url }) => url.pathname.endsWith('/data/meta.json'),
  async ({ request }) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
    try {
      const res = await fetch(request, { signal: ctrl.signal });
      if (res.ok) return res;
    } catch {
      /* offline or too slow: use the installed copy */
    } finally {
      clearTimeout(timer);
    }
    const cached = await matchPrecache(request.url);
    return cached ?? Response.error();
  },
);

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// A reload or an installed-app launch while offline still gets the app shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL(new URL('index.html', self.registration.scope).href)));

// A new version waits until the page asks for it (see src/state/updates.ts), so an update never lands mid-entry.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
clientsClaim();
