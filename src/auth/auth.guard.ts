import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from './constants';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
    private authService: AuthService,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    try {
      if (token) {
        try {
          // Attempt to verify as our own JWT
          const payload = await this.jwtService.verifyAsync(token, {
            secret: this.configService.get<string>('JWT_SECRET'),
          });
          request['vault_token'] = payload.vault_token;
          request['user_id'] = payload.user_id;
        } catch (e) {
          // Fallback: decode as a general JWT (like Supabase)
          const decoded: any = this.jwtService.decode(token);
          if (decoded) {
            request['user_id'] = decoded.sub || decoded.email || 'demo_user';
            this.logger.log(`Extracted user_id from decoded token: ${request['user_id']}`);
          }
        }
      }

      // If we don't have a vault_token (because it's a Supabase user or no token),
      // we get a manager token using the AppRole credentials from ENV.
      if (!request['vault_token']) {
        const roleId = this.configService.get<string>('VAULT_ROLE_ID');
        const secretId = this.configService.get<string>('VAULT_SECRET_ID');

        if (roleId && secretId) {
          request['vault_token'] = await this.authService.signInWithRole(roleId, secretId);
        } else {
          // If no credentials, we might use a direct VAULT_TOKEN if available
          request['vault_token'] = this.configService.get<string>('VAULT_TOKEN');
        }
      }

      if (!request['vault_token']) {
        this.logger.error('No vault_token available for request');
        throw new UnauthorizedException('Vault authentication failed');
      }

    } catch (err) {
      this.logger.error('Auth verification failed', err.message);
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
