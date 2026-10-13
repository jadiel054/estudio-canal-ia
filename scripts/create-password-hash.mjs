import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
function derive(password, salt, keyLength, N, r, p) {
  return new Promise((resolve, reject) => scryptCallback(password, salt, keyLength, { N, r, p, maxmem: 256 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)));
}
const rl = readline.createInterface({ input, output });
try {
  const password = await rl.question("Senha inicial (mínimo 12 caracteres): ");
  if (password.length < 12) throw new Error("A senha precisa ter pelo menos 12 caracteres.");
  const salt = randomBytes(16); const n = 131072; const r = 8; const p = 1;
  const derived = await derive(password, salt, 64, n, r, p);
  console.log(`STUDIO_OWNER_PASSWORD_HASH=scrypt$${n}$${r}$${p}$${salt.toString("base64")}$${Buffer.from(derived).toString("base64")}`);
} finally { rl.close(); }
