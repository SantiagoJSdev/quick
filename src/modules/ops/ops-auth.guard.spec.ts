import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { OpsAuthGuard } from './ops-auth.guard';

function mockContext(req: Partial<Request>) {
  return {
    switchToHttp: () => ({
      getRequest: () => req as Request,
    }),
  };
}

describe('OpsAuthGuard', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows when OPS_API_KEY and OPS_IP_ALLOWLIST are unset', () => {
    const config = {
      get: (k: string) => (k === 'OPS_API_KEY' || k === 'OPS_IP_ALLOWLIST' ? undefined : undefined),
    } as unknown as ConfigService;
    const guard = new OpsAuthGuard(config);
    const ctx = mockContext({
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('rejects wrong API key', () => {
    const config = {
      get: (k: string) => (k === 'OPS_API_KEY' ? 'secret' : undefined),
    } as unknown as ConfigService;
    const guard = new OpsAuthGuard(config);
    const ctx = mockContext({
      headers: { 'x-ops-api-key': 'wrong' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request);
    expect(() => guard.canActivate(ctx as never)).toThrow(UnauthorizedException);
  });

  it('accepts X-Ops-Api-Key', () => {
    const config = {
      get: (k: string) => (k === 'OPS_API_KEY' ? 'secret' : undefined),
    } as unknown as ConfigService;
    const guard = new OpsAuthGuard(config);
    const ctx = mockContext({
      headers: { 'x-ops-api-key': 'secret' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('accepts Authorization: Bearer', () => {
    const config = {
      get: (k: string) => (k === 'OPS_API_KEY' ? 'secret' : undefined),
    } as unknown as ConfigService;
    const guard = new OpsAuthGuard(config);
    const ctx = mockContext({
      headers: { authorization: 'Bearer secret' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('rejects IP not in OPS_IP_ALLOWLIST', () => {
    const config = {
      get: (k: string) =>
        k === 'OPS_IP_ALLOWLIST' ? '10.0.0.1' : undefined,
    } as unknown as ConfigService;
    const guard = new OpsAuthGuard(config);
    const ctx = mockContext({
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request);
    expect(() => guard.canActivate(ctx as never)).toThrow(ForbiddenException);
  });

  it('accepts IP in OPS_IP_ALLOWLIST (no key required)', () => {
    const config = {
      get: (k: string) =>
        k === 'OPS_IP_ALLOWLIST' ? '127.0.0.1' : undefined,
    } as unknown as ConfigService;
    const guard = new OpsAuthGuard(config);
    const ctx = mockContext({
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('honors X-Forwarded-For first hop when allowlisted', () => {
    const config = {
      get: (k: string) =>
        k === 'OPS_IP_ALLOWLIST' ? '203.0.113.9' : undefined,
    } as unknown as ConfigService;
    const guard = new OpsAuthGuard(config);
    const ctx = mockContext({
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      socket: { remoteAddress: '10.0.0.2' },
    } as unknown as Request);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });
});
