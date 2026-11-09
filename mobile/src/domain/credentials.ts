import { pbkdf2Async } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha2'

const ITERATIONS = 100_000
const KEY_LENGTH = 32

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createPasswordHash(
  password: string,
  salt: string,
): Promise<{ salt: string; hash: string; iterations: number }> {
  const derived = await pbkdf2Async(sha256, password, salt, { c: ITERATIONS, dkLen: KEY_LENGTH })
  return { salt, hash: toHex(derived), iterations: ITERATIONS }
}

export async function verifyPasswordHash(password: string, salt: string, iterations: number): Promise<string> {
  const derived = await pbkdf2Async(sha256, password, salt, { c: iterations, dkLen: KEY_LENGTH })
  return toHex(derived)
}
