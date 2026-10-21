// config/boards/index.js
// Central board registry and resolution utility

const fbise = require('./fbise');
const biseLahore = require('./bise-lahore');

const BOARDS = {
  fbise,
  'bise-lahore': biseLahore
};

/**
 * Get board configuration by name or key.
 * Defaults to FBISE if not matched.
 */
function getBoardConfig(boardNameOrKey) {
  if (!boardNameOrKey) return fbise;
  const normalized = String(boardNameOrKey).toLowerCase().trim();

  if (normalized.includes('fbise') || normalized.includes('federal')) {
    return fbise;
  }
  if (normalized.includes('lahore')) {
    return biseLahore;
  }
  return BOARDS[normalized] || fbise;
}

/**
 * Normalize an incoming raw CSV header to a canonical BoardResult field.
 */
function normalizeColumnHeader(header, boardConfig = fbise) {
  if (!header) return null;
  const clean = String(header).toLowerCase().replace(/[^a-z0-9_%]/g, '_').replace(/_+/g, '_').trim();
  const rawClean = String(header).toLowerCase().trim();

  for (const [canonicalField, aliases] of Object.entries(boardConfig.columnAliases || {})) {
    for (const alias of aliases) {
      const aliasClean = String(alias).toLowerCase().replace(/[^a-z0-9_%]/g, '_').replace(/_+/g, '_').trim();
      if (clean === aliasClean || rawClean === alias.toLowerCase()) {
        return canonicalField;
      }
    }
  }
  return null;
}

module.exports = {
  BOARDS,
  getBoardConfig,
  normalizeColumnHeader,
  defaultBoard: fbise
};
