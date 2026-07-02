// User-secret keychain registry — the only place a secret name is declared.
// setUserSecret rejects names not listed here, and the userSecrets query joins
// this list against per-user rows, so adding a key here is the whole change:
// no migration, no new UI code (the Account Integrations card is registry-driven).
module.exports = [
  // [FRAMEWORK]
  { name: 'anthropic_api_key', label: 'Anthropic API Key' },

  // [MY DOMAIN] — app-specific keys go here
];
