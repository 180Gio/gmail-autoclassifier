import type { NextFunction, Request, Response } from 'express'
import type { Account } from '../shared/types.ts'
import { getAccount } from './gmail/oauth.ts'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Read the input needed by handlers that operate on the connected account. */
export function requireAccount(): Account {
  const account = getAccount()
  if (!account) throw new HttpError(401, 'No Gmail account connected.')
  return account
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const withStatus = err as { status?: number; statusCode?: number }
  const status =
    err instanceof HttpError ? err.status : (withStatus.status ?? withStatus.statusCode ?? 500)
  const message = err instanceof Error ? err.message : String(err)
  if (status >= 500) console.error(err)
  res.status(status).json({ error: message })
}
