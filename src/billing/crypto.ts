import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { EncryptionNotConfiguredError } from '../lib/errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // tamanho recomendado para GCM

export type SealedSecret = { ciphertext: Buffer; iv: Buffer; authTag: Buffer };

function masterKey(): Buffer {
  if (!env.AI_KEY_ENCRYPTION_KEY) throw new EncryptionNotConfiguredError();
  return Buffer.from(env.AI_KEY_ENCRYPTION_KEY, 'base64');
}

export function seal(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function open(sealed: SealedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, masterKey(), sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  // `final()` lança se o authTag não bater: adulteração falha aqui, nunca silenciosamente.
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}

export function last4(plaintext: string): string {
  return plaintext.slice(-4);
}
