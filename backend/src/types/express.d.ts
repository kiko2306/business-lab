import { AuthAccessPayload } from './index';

declare global {
  namespace Express {
    interface Request {
      user?: AuthAccessPayload;
    }
  }
}

export {};
