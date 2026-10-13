import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { requestContext } from '../common/request-context';
import { SessionService } from './session.service';

export interface AuthUser {
  userId: string;
  sessionId: string;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

const IS_PUBLIC = 'isPublic';
/** Marks an endpoint as reachable without signing in. Everything else is denied by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

type AuthedRequest = Request & { auth?: AuthUser };

/** The signed-in user and session for this request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) throw new UnauthorizedException();
    return auth;
  },
);

/**
 * Global guard: verifies the access token and checks the session is still
 * active, so a revoked session stops working on its very next request (spec §3.3).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Sign in required');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    if (!(await this.sessions.isActive(payload.sid, payload.sub))) {
      throw new UnauthorizedException('Session ended');
    }
    req.auth = { userId: payload.sub, sessionId: payload.sid };
    const reqCtx = requestContext();
    if (reqCtx) reqCtx.sessionId = payload.sid;
    return true;
  }
}
