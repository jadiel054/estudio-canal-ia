import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { parse as parseCookie } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";

function derive(password: string, salt: Buffer, keyLength: number, N: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, keyLength, { N, r, p, maxmem: 256 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result as Buffer)));
}
export const SESSION_COOKIE = "studio_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const isProduction = () => process.env.NODE_ENV === "production";

export type OwnerUser = { id: string; openId: string; name: string; email: string; role: "admin"; loginMethod: "password"; createdAt: Date; updatedAt: Date; lastSignedIn: Date };

function ownerEmail() { return (process.env.STUDIO_OWNER_EMAIL ?? "").trim().toLowerCase(); }
function sessionSecret() {
  const value = process.env.STUDIO_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("STUDIO_SESSION_SECRET precisa ter pelo menos 32 caracteres");
  return new TextEncoder().encode(value);
}
export function isOwnerConfigured() { return Boolean(ownerEmail() && process.env.STUDIO_OWNER_PASSWORD_HASH && process.env.STUDIO_SESSION_SECRET); }

export async function verifyOwnerPassword(password: string) {
  const expectedEmail = ownerEmail();
  const stored = process.env.STUDIO_OWNER_PASSWORD_HASH ?? "";
  if (!expectedEmail || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nText, rText, pText, saltB64, hashB64] = parts;
  const n = Number(nText); const r = Number(rText); const p = Number(pText);
  if (![n, r, p].every(Number.isSafeInteger) || n < 16_384 || r < 8 || p < 1) return false;
  try {
    const derived = await derive(password, Buffer.from(saltB64, "base64"), 64, n, r, p);
    const expected = Buffer.from(hashB64, "base64");
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch { return false; }
}

export async function hashOwnerPassword(password: string) {
  if (password.length < 12) throw new Error("A senha precisa ter pelo menos 12 caracteres");
  const n = 131072; const r = 8; const p = 1;
  const salt = randomBytes(16);
  const derived = await derive(password, salt, 64, n, r, p);
  return `scrypt$${n}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function ownerUser(): OwnerUser {
  const email = ownerEmail();
  return { id: `owner:${email}`, openId: `owner:${email}`, name: email.split("@")[0] || "Dono", email, role: "admin", loginMethod: "password", createdAt: new Date(0), updatedAt: new Date(), lastSignedIn: new Date() };
}

export async function createSessionToken() {
  const user = ownerUser();
  return new SignJWT({ sub: user.id, email: user.email, role: "admin", name: user.name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionSecret());
}
export async function readSession(req: Request): Promise<OwnerUser | null> {
  const token = parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE];
  if (!token || !isOwnerConfigured()) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (payload.role !== "admin" || payload.email !== ownerEmail() || payload.sub !== `owner:${ownerEmail()}`) return null;
    return ownerUser();
  } catch { return null; }
}
export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: SESSION_TTL_SECONDS * 1000 });
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: -1 });
}
export async function loginOwner(email: string, password: string, res: Response) {
  if (email.trim().toLowerCase() !== ownerEmail() || !(await verifyOwnerPassword(password))) return false;
  setSessionCookie(res, await createSessionToken());
  return true;
}
export const authConfigSummary = () => ({ configured: isOwnerConfigured(), email: ownerEmail() || null, method: "email + senha" as const, session: "cookie httpOnly Secure SameSite=None" as const });
