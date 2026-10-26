import { type ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { loadAuthClient } from '../../lib/auth/client.ts';
import { useI18n } from '../../lib/i18n/index.ts';
import { ResultCard } from '../../ui/index.ts';

/** Magic-link landing: the SDK reads the session from the URL; used/expired links fail cleanly (EC-134/135). */
export function AuthCallback(): ReactNode {
  const i = useI18n();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(() =>
    /error_code=|error=/.test(window.location.hash + window.location.search),
  );
  useEffect(() => {
    if (failed) return;
    void loadAuthClient()
      .then((auth) => auth.getSession())
      .then(({ data }) => {
        if (data.session === null) setFailed(true);
        else void navigate('/', { replace: true });
      })
      .catch(() => {
        setFailed(true);
      });
  }, [failed, navigate]);
  if (!failed) return <ResultCard variant="checking" title={i.t('auth.callback')} />;
  return (
    <div className="flex flex-col gap-3">
      <ResultCard variant="invalid" title={i.t('auth.linkExpired')} />
      <Link
        to="/login"
        className="flex min-h-14 items-center justify-center rounded-btn bg-success font-semibold text-white"
      >
        {i.t('auth.requestLink')}
      </Link>
    </div>
  );
}
