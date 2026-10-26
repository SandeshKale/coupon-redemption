import { realDeps } from '../_shared/deps.ts';
import { handler } from './handler.ts';

Deno.serve((req) => handler(req, realDeps('admin-create-user', req)));
