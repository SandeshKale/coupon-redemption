import { type ReactNode, useEffect, useState } from 'react';
import * as v from 'valibot';

import { useServices } from '../lib/services.ts';

import { AppRoutes } from './routes.tsx';

/** The helpline 24M sets in the back office wins over the one baked into the build. */
export function LiveRoutes({ helpline }: { readonly helpline: string | null }): ReactNode {
  const { api } = useServices();
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void api.rpc('public_helpline', {}, v.nullable(v.string())).then((r) => {
      if (current && r.ok && r.data !== null && r.data !== '') setLive(r.data);
    });
    return () => {
      current = false;
    };
  }, [api]);
  return <AppRoutes helpline={live ?? helpline} />;
}
