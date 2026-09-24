import { AuthenticatedUser } from './application/auth.service';

export interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user?: AuthenticatedUser;
}

