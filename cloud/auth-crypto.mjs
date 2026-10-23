import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";

// OWASP scrypt profile: 16 MiB, r=8, p=5. Native crypto works in workerd with nodejs_compat.
export const token = () => randomBytes(32).toString("hex");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const equal = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function passwordValid(value) {
  return (
    typeof value === "string" &&
    value.length >= 10 &&
    Buffer.byteLength(value) <= 256
  );
}
export async function passwordHash(
  value,
  salt = randomBytes(16).toString("hex"),
) {
  const key = await new Promise((resolve, reject) =>
    scrypt(
      value,
      salt,
      32,
      { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
  return `scrypt$16384$8$5$${salt}$${key.toString("hex")}`;
}
export async function passwordMatches(value, hash) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 256) return false;
  const fields = String(hash).split("$");
  if (
    fields.length !== 6 ||
    fields.slice(0, 4).join("$") !== "scrypt$16384$8$5"
  )
    return false;
  return equal(await passwordHash(value, fields[4]), hash);
}
