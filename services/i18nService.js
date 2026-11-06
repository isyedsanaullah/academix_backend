const en = require('../config/i18n/en.json');
const ur = require('../config/i18n/ur.json');

const dictionaries = { en, ur };

/**
 * Bilingual UI & Right-to-Left (RTL) Document Service (N09)
 */

function getLocaleConfig(locale = 'en') {
  const cleanLocale = String(locale).toLowerCase() === 'ur' ? 'ur' : 'en';
  return dictionaries[cleanLocale];
}

function translate(key, locale = 'en') {
  const config = getLocaleConfig(locale);
  return config.labels[key] || en.labels[key] || key;
}

function getDocumentMetadata(locale = 'en') {
  const isUrdu = String(locale).toLowerCase() === 'ur';
  return {
    locale: isUrdu ? 'ur' : 'en',
    dir: isUrdu ? 'rtl' : 'ltr',
    fontFamily: isUrdu ? 'Jameel Noori Nastaleeq, serif' : 'Helvetica, Arial, sans-serif',
    labels: isUrdu ? ur.labels : en.labels,
  };
}

module.exports = {
  getLocaleConfig,
  translate,
  getDocumentMetadata,
};

