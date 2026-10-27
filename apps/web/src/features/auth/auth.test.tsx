import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  signInWithPassword: vi.fn(),
  mfa: { listFactors: vi.fn(), enroll: vi.fn(), challengeAndVerify: vi.fn() },
  getSession: vi.fn(),
};
vi.mock('../../lib/auth/client.ts', () => ({ loadAuthClient: () => Promise.resolve(auth) }));

import { renderAt } from '../../test/render.tsx';
import { API, server } from '../../test/server.ts';

import { AuthCallback } from './AuthCallback.tsx';
import { LoginPage } from './LoginPage.tsx';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('request a new link (anti-enumeration answer), rate limits and offline', async () => {
    let n = 0;
    server.use(
      http.post(`${API}/functions/v1/login-link-request`, () =>
        n++ === 0
          ? HttpResponse.json({ result: 'RECEIVED' }, { status: 202 })
          : HttpResponse.json({ result: 'RATE_LIMITED' }, { status: 429 }),
      ),
    );
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    const mobile = screen.getByLabelText('Your mobile number');
    await userEvent.type(mobile, '12');
    expect(screen.getByRole('button', { name: 'Request new login link' })).toBeDisabled();
    await userEvent.clear(mobile);
    await userEvent.type(mobile, '9800000001');
    await userEvent.click(screen.getByRole('button', { name: 'Request new login link' }));
    expect(
      await screen.findByText('Request sent. Your distributor will send a new link on WhatsApp.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Request new login link' }));
    expect(await screen.findByText('Too many requests. Try again in an hour.')).toBeInTheDocument();
    server.use(http.post(`${API}/functions/v1/login-link-request`, () => HttpResponse.error()));
    await userEvent.click(screen.getByRole('button', { name: 'Request new login link' }));
    expect(
      await screen.findByText('Could not send your request. Check your internet and try again.'),
    ).toBeInTheDocument();
    server.use(
      http.post(`${API}/functions/v1/login-link-request`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Request new login link' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });

  it('24M: wrong password', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'bad' } });
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'a@24m.in');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
  });

  it('24M: verified factor → TOTP (wrong then right code)', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1' }] } });
    auth.mfa.challengeAndVerify
      .mockResolvedValueOnce({ error: { message: 'x' } })
      .mockResolvedValueOnce({ error: null });
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'a@24m.in');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const code = await screen.findByLabelText('6-digit code from your authenticator app');
    await userEvent.type(code, '123 456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Wrong code. Try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('navigated')).toBeInTheDocument();
    expect(auth.mfa.challengeAndVerify).toHaveBeenLastCalledWith({
      factorId: 'f1',
      code: '123456',
    });
  });

  it('24M: first login enrols TOTP; enrolment failure', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.mfa.listFactors.mockResolvedValue({ data: { totp: [] } });
    auth.mfa.enroll.mockResolvedValueOnce({
      error: null,
      data: { id: 'f2', totp: { qr_code: 'data:image/svg+xml;base64,PHN2Zy8+', secret: 'SECRET' } },
    });
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'a@24m.in');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(
      await screen.findByRole('img', { name: 'Authenticator setup QR code' }),
    ).toBeInTheDocument();
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });

  it('24M: enrolment error', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.mfa.listFactors.mockResolvedValue({ data: null });
    auth.mfa.enroll.mockResolvedValueOnce({ error: { message: 'x' }, data: null });
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'a@24m.in');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });
});

describe('AuthCallback (EC-134/135)', () => {
  it('logs in with a session from the link', async () => {
    auth.getSession.mockResolvedValue({ data: { session: {} } });
    renderAt(<AuthCallback />, { path: '/auth/callback', route: '/auth/callback' });
    expect(await screen.findByText('navigated')).toBeInTheDocument();
  });

  it('used or expired links fail cleanly', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    renderAt(<AuthCallback />, { path: '/auth/callback', route: '/auth/callback' });
    expect(
      await screen.findByText('This login link has expired or was already used.'),
    ).toBeInTheDocument();
  });

  it('SDK errors and error fragments', async () => {
    auth.getSession.mockRejectedValue(new Error('x'));
    renderAt(<AuthCallback />, { path: '/auth/callback', route: '/auth/callback' });
    await waitFor(() => {
      expect(
        screen.getByText('This login link has expired or was already used.'),
      ).toBeInTheDocument();
    });
    window.location.hash = '#error=access_denied&error_code=otp_expired';
    renderAt(<AuthCallback />, { path: '/auth/callback', route: '/auth/callback' });
    expect(
      screen.getAllByText('This login link has expired or was already used.').length,
    ).toBeGreaterThan(0);
    window.location.hash = '';
  });
});
