// User-secret keychain — the ONLY module that encrypts or decrypts user_secrets.
// Raw values enter through setUserSecret and leave only through getUserSecret,
// called by server code that needs the key (never by a resolver returning API
// data). Everything user-facing gets metadata: {name, label, isSet, last4, updated_at}.
//
// Ciphertext layout: 12-byte nonce || 16-byte GCM auth tag || ciphertext.
// Master key: SECRETS_MASTER_KEY env var, 64 hex chars (32 bytes). key_version
// allows master-key rotation without all-or-nothing re-encryption.
const crypto = require('crypto');
const { pool } = require('../db');
const registry = require('../secrets-registry');

const NONCE_LENGTH = 12;
const TAG_LENGTH   = 16;
const KEY_VERSION  = 1;

const masterKey = () => {
  const hex = process.env.SECRETS_MASTER_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('SECRETS_MASTER_KEY is not set to 64 hex chars — generate one with `openssl rand -hex 32` and add it to .env');
  }
  return Buffer.from(hex, 'hex');
};

const assertRegistered = (name) => {
  if (!registry.some(entry => entry.name === name)) {
    throw new Error(`Unknown secret name: ${name}`);
  }
};

const encrypt = (value) => {
  const nonce  = crypto.randomBytes(NONCE_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), nonce);
  const ct     = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ct]);
};

const decrypt = (blob) => {
  const nonce    = blob.subarray(0, NONCE_LENGTH);
  const tag      = blob.subarray(NONCE_LENGTH, NONCE_LENGTH + TAG_LENGTH);
  const ct       = blob.subarray(NONCE_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
};

const setUserSecret = async (ownerId, name, value) => {
  assertRegistered(name);
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new Error('Secret value must not be empty');
  await pool.query(
    `INSERT INTO user_secrets (owner_id, name, ciphertext, last4, key_version, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, NOW())
     ON CONFLICT (owner_id, name) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext, last4 = EXCLUDED.last4,
           key_version = EXCLUDED.key_version, updated_at = NOW()`,
    [ownerId, name, encrypt(trimmed), trimmed.slice(-4), KEY_VERSION]
  );
};

const getUserSecret = async (ownerId, name) => {
  assertRegistered(name);
  const res = await pool.query(
    'SELECT ciphertext FROM user_secrets WHERE owner_id = $1::uuid AND name = $2',
    [ownerId, name]
  );
  if (!res.rows.length) return null;
  return decrypt(res.rows[0].ciphertext);
};

const clearUserSecret = async (ownerId, name) => {
  assertRegistered(name);
  await pool.query(
    'DELETE FROM user_secrets WHERE owner_id = $1::uuid AND name = $2',
    [ownerId, name]
  );
};

// Registry ⋈ per-user rows — metadata only, never decrypts.
const listUserSecrets = async (ownerId) => {
  const res = await pool.query(
    'SELECT name, last4, updated_at FROM user_secrets WHERE owner_id = $1::uuid',
    [ownerId]
  );
  const byName = Object.fromEntries(res.rows.map(r => [r.name, r]));
  return registry.map(({ name, label }) => ({
    name,
    label,
    isSet:      !!byName[name],
    last4:      byName[name]?.last4 ?? null,
    updated_at: byName[name]?.updated_at ?? null,
  }));
};

module.exports = { setUserSecret, getUserSecret, clearUserSecret, listUserSecrets };
