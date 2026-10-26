import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { notifyUpdate } from './app/UpdateBanner.tsx';
import { prefetchDealerRoutes } from './app/lazy.ts';
import { AppRoutes } from './app/routes.tsx';
import { prefetchAuthWhenIdle } from './lib/auth/client.ts';
import { config } from './lib/config.ts';
import { I18nProvider } from './lib/i18n/index.ts';
import { createServices, ServicesContext } from './lib/services.ts';
import { initTelemetryWhenIdle, reportError } from './lib/telemetry.ts';
import './styles.css';

const services = createServices(config);

window.addEventListener('error', (e) => {
  reportError(e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  reportError(e.reason);
});

// Service worker registration is off the critical path (its own chunk, after load).
window.addEventListener('load', () => {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh: () => {
        notifyUpdate(() => updateSW(true));
      },
    });
  });
  prefetchAuthWhenIdle();
  prefetchDealerRoutes();
  initTelemetryWhenIdle();
});

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <ServicesContext.Provider value={services}>
        <I18nProvider>
          <BrowserRouter>
            <AppRoutes helpline={config.helpline} />
          </BrowserRouter>
        </I18nProvider>
      </ServicesContext.Provider>
    </StrictMode>,
  );
}
