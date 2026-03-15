export interface JwtPayload {
  sub: string; // user ID
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
}
