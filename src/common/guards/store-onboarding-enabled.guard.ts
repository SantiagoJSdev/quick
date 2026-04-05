import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * PUT /stores/:id y PUT /stores/:id/business-settings (onboarding) solo si
 * STORE_ONBOARDING_ENABLED=1 en entorno.
 */
@Injectable()
export class StoreOnboardingEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    const v = (this.config.get<string>('STORE_ONBOARDING_ENABLED') ?? '').trim();
    if (v === '1' || v.toLowerCase() === 'true') {
      return true;
    }
    throw new ForbiddenException(
      'Store onboarding is disabled. Set STORE_ONBOARDING_ENABLED=1 on the server to allow POS-created stores (use only in trusted networks).',
    );
  }
}
