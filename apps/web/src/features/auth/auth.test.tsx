import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  signInWithPassword: vi.fn(),
  setSession: vi.fn(),
  mfa: { listFactors: vi.fn(), enroll: vi.fn(), challengeAndVerify: vi.fn() },
};
vi.mock('../../lib/auth/client.ts', () => ({ loadAuthClient: () => Promise.resolve(auth) }));

import { LOGIN_AT_KEY } from '../../lib/auth/session.ts';
import { renderAt } from '../../test/render.tsx';
import { fn } from '../../test/server.ts';

import { LoginPage, safeNext } from './LoginPage.tsx';

beforeEach(() => {
  vi.clearAllMocks();
  auth.setSession.mockResolvedValue({ error: null });
});

const TOKENS = { access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'bearer' };

async function fillPin(mobile: string, pin: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('Registered mobile number'), mobile);
  await userEvent.type(screen.getByLabelText('4-digit PIN'), pin);
}

describe('safeNext', () => {
  it('only allows paths on this site', () => {
    expect(safeNext('/c/ABC')).toBe('/c/ABC');
    expect(safeNext(null)).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('evil')).toBe('/');
  });
});

describe('LoginPage: mobile number and PIN', () => {
  it('a good login stores the session and goes on', async () => {
    let body: unknown = null;
    fn('pin-login', async (req) => ((body = await req.json()), HttpResponse.json(TOKENS)));
    renderAt(<LoginPage />, { path: '/login', route: '/login?next=%2Fc%2FABC' });
    await fillPin('98000 00001', '4817');
    await userEvent.click(screen.getAllByRole('button', { name: 'Log in' })[0]!);
    expect(await screen.findByText('navigated')).toBeInTheDocument();
    expect(body).toEqual({ mobile: '+919800000001', pin: '4817' });
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
    expect(localStorage.getItem(LOGIN_AT_KEY)).not.toBeNull();
  });

  it('only digits are accepted in the PIN, at most four', async () => {
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    const pin = screen.getByLabelText('4-digit PIN');
    await userEvent.type(pin, '4a8b1c7d9');
    expect(pin).toHaveValue('4817');
  });

  it('is not submittable until the mobile and PIN are complete', async () => {
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await userEvent.type(screen.getByLabelText('Registered mobile number'), '12');
    await userEvent.type(screen.getByLabelText('4-digit PIN'), '48');
    expect(screen.getByText('Enter a valid mobile number and a 4-digit PIN.')).toBeInTheDocument();
  });

  it.each([
    [401, 'Wrong mobile number or PIN. After 5 wrong tries the login is locked for a while.'],
    [429, 'Too many tries. Try again in 10 minutes.'],
    [500, 'Could not send your request. Check your internet and try again.'],
  ])('status %i shows a clear message and clears the PIN', async (status, text) => {
    fn('pin-login', () => HttpResponse.json({ error: 'x' }, { status }));
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await fillPin('9800000001', '4817');
    await userEvent.click(screen.getAllByRole('button', { name: 'Log in' })[0]!);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByLabelText('4-digit PIN')).toHaveValue('');
  });

  it('a network failure says so', async () => {
    fn('pin-login', () => HttpResponse.error());
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await fillPin('9800000001', '4817');
    await userEvent.click(screen.getAllByRole('button', { name: 'Log in' })[0]!);
    expect(
      await screen.findByText('Could not send your request. Check your internet and try again.'),
    ).toBeInTheDocument();
  });
});

describe('LoginPage: 24M staff', () => {
  const staff = async (): Promise<void> => {
    await userEvent.type(screen.getByLabelText('Email'), 'a@24m.in');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getAllByRole('button', { name: 'Log in' })[1]!);
  };

  it('wrong password', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'bad' } });
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await staff();
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
  });

  it('verified factor → TOTP (wrong then right code)', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1' }] } });
    auth.mfa.challengeAndVerify
      .mockResolvedValueOnce({ error: { message: 'x' } })
      .mockResolvedValueOnce({ error: null });
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await staff();
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

  it('first login enrols TOTP', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.mfa.listFactors.mockResolvedValue({ data: { totp: [] } });
    auth.mfa.enroll.mockResolvedValueOnce({
      error: null,
      data: { id: 'f2', totp: { qr_code: 'data:image/svg+xml;base64,PHN2Zy8+', secret: 'SECRET' } },
    });
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await staff();
    expect(
      await screen.findByRole('img', { name: 'Authenticator setup QR code' }),
    ).toBeInTheDocument();
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });

  it('enrolment error', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.mfa.listFactors.mockResolvedValue({ data: null });
    auth.mfa.enroll.mockResolvedValueOnce({ error: { message: 'x' }, data: null });
    renderAt(<LoginPage />, { path: '/login', route: '/login' });
    await staff();
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });
});
