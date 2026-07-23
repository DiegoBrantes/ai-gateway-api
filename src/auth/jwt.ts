import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  sub: string;
  scope?: string[];
}

/** Issue a signed token — handy for the `/auth/token` demo endpoint. */
export function signToken(payload: JwtPayload): string {
  // expiresIn accepts the vercel/ms string form ("1h", "7d"); the typings
  // model it as a template-literal union, so a plain string needs a cast.
  const options = { expiresIn: env.JWT_EXPIRES_IN } as SignOptions;
  return jwt.sign(payload, env.JWT_SECRET, options);
}

/** Verify a bearer token, returning the payload or null when invalid. */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}
