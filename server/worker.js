// Cloudflare Workers entry: /api/* is the server, everything else the built app in dist/.
import { handleApi } from './api.js';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url.pathname.slice(5).split('/').filter(Boolean));
    return env.ASSETS.fetch(request);
  }
};
