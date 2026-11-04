import crypto from "node:crypto";

const TMS_SALT = "iriso-tms-salt-2026";
const TMS_MASTER_SECRET = "componetlife-tms-production-key-v1-iriso";

// Derived 256-bit encryption key
const DERIVED_KEY = crypto.pbkdf2Sync(
  TMS_MASTER_SECRET,
  TMS_SALT,
  100000,
  32,
  "sha256"
);

// Cryptographically hashed & AES-256-GCM encrypted payload
const ENCRYPTED_TMS_VAULT = {
  iv: "d5bc6262bb635d835f0c41a8",
  tag: "09a1d3fcc15401304bdc173e39a3f17b",
  ciphertext:
    "578ae3f525b71deb47c60ed9e4dde426712cf156d73fda5af622725718f8226fa2db60ac93c2315b2fbe9d",
  hashes: {
    userHash: "63b9444f5e6cc5e84a96f8618baa25870592745a741d40c36f91ac819c80fcaa",
    passHash: "3faa0b38c226b2cf3fa97a89faa9be415a1fbd51d6981639d81ab7babf4c8392",
    algorithm: "PBKDF2-HMAC-SHA256+AES-256-GCM"
  }
};

/**
 * An toàn giải mã thông tin tài khoản TMS trong bộ nhớ RAM tạm thời
 */
export function getDecryptedTmsCredentials() {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    DERIVED_KEY,
    Buffer.from(ENCRYPTED_TMS_VAULT.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(ENCRYPTED_TMS_VAULT.tag, "hex"));
  let decrypted = decipher.update(ENCRYPTED_TMS_VAULT.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}

/**
 * Trả về thông tin băm bảo mật (không lộ mật khẩu gốc)
 */
export function getTmsSecurityMetadata() {
  return {
    vaultStatus: "encrypted_aes256_gcm",
    keyDerivation: "pbkdf2_sha256_100k_iterations",
    userHash: ENCRYPTED_TMS_VAULT.hashes.userHash,
    passHash: ENCRYPTED_TMS_VAULT.hashes.passHash,
    lastSecured: "2026-10-30T09:50:00Z"
  };
}
