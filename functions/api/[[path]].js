// Cloudflare Pages entry: /api/* goes to the shared handler.
import { handleApi } from '../../server/api.js';
export const onRequest = ({ request, env, params }) => handleApi(request, env, params.path || []);
