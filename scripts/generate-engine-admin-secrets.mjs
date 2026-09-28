import { pbkdf2Sync, randomBytes } from "node:crypto";

const email = String(process.env.ENGINE_ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(process.env.ENGINE_ADMIN_PASSWORD || "");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error("Set ENGINE_ADMIN_EMAIL to the dedicated Engine Admin email.");
if (password.length < 12)
  throw new Error("Set ENGINE_ADMIN_PASSWORD to a dedicated 12+ character password.");

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 210000, 32, "sha256");
const sessionSecret = randomBytes(48).toString("base64");

process.stdout.write(
  [
    "Dedicated Rekixo AR3D Engine Admin values:",
    `ENGINE_ADMIN_EMAIL=${email}`,
    `ENGINE_ADMIN_PASSWORD_SALT=${salt.toString("base64")}`,
    `ENGINE_ADMIN_PASSWORD_HASH=${hash.toString("base64")}`,
    `ENGINE_ADMIN_SESSION_SECRET=${sessionSecret}`,
    "",
    "Store these as Cloudflare Worker secrets/vars for rekixo-3d-admin.",
    "Do not reuse Rekixo Platform/Super Admin credentials.",
    "The plaintext password is not printed.",
  ].join("\n"),
);
