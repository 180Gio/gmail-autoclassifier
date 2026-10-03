import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { SESSION_SECRET } from './env.ts'

// Derive a stable 32-byte AES key from SESSION_SECRET.
const KEY = createHash('sha256').update(SESSION_SECRET).digest()

/**
 * Encrypt a string with AES-256-GCM.
 * Returns `iv:tag:ciphertext`, each part base64 encoded.
 */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':')
}

/**
 * Decrypt a value produced by {@link encrypt}. Values that are not in the
 * expected `iv:tag:data` shape are returned unchanged, so pre-existing
 * plaintext values keep working after an upgrade.
 */
export function decrypt(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) return payload
  try {
    const [iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    // Wrong key or tampered value: fail closed with an empty secret.
    return ''
  }
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}
