import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import os from "node:os";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const SALT = "multimail-connector-v1";

function deriveKey(): Buffer {
  const explicit = process.env.MULTIMAIL_CONNECTOR_KEY;
  if (explicit && explicit.length >= 16) {
    return scryptSync(explicit, SALT, 32);
  }
  const seed = `${os.hostname()}::${os.userInfo().username}::multimail`;
  return scryptSync(seed, SALT, 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("malformed encrypted payload");
  const [ivB64, tagB64, encB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const decipher = createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "•".repeat(token.length);
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
