#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const I18N_ROOT = path.join(__dirname, '../src/i18n');
const EN_DIR = path.join(I18N_ROOT, 'en');
const VI_DIR = path.join(I18N_ROOT, 'vi');

/**
 * Get all keys of an object recursively
 * @param {object} obj 
 * @param {string} prefix 
 * @returns {string[]}
 */
function getAllKeys(obj, prefix = '') {
  return Object.keys(obj).reduce((keys, key) => {
    const value = obj[key];
    const newPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return [...keys, ...getAllKeys(value, newPrefix)];
    }
    return [...keys, newPrefix];
  }, []);
}

function checkParity() {
  if (!fs.existsSync(EN_DIR) || !fs.existsSync(VI_DIR)) {
    console.error('Error: i18n directories not found');
    process.exit(1);
  }

  const enFiles = fs.readdirSync(EN_DIR).filter(file => file.endsWith('.json'));
  const viFiles = fs.readdirSync(VI_DIR).filter(file => file.endsWith('.json'));

  let hasError = false;

  // Check file set parity
  const enFileSet = new Set(enFiles);
  const viFileSet = new Set(viFiles);

  for (const file of enFiles) {
    if (!viFileSet.has(file)) {
      console.error(`Error: File missing in vi/ directory: ${file}`);
      hasError = true;
    }
  }

  for (const file of viFiles) {
    if (!enFileSet.has(file)) {
      console.error(`Error: File missing in en/ directory: ${file}`);
      hasError = true;
    }
  }

  // Check key parity for each file
  for (const file of enFiles) {
    if (!viFileSet.has(file)) continue;

    const enContent = JSON.parse(fs.readFileSync(path.join(EN_DIR, file), 'utf8'));
    const viContent = JSON.parse(fs.readFileSync(path.join(VI_DIR, file), 'utf8'));

    const enKeys = getAllKeys(enContent);
    const viKeys = getAllKeys(viContent);

    const enKeySet = new Set(enKeys);
    const viKeySet = new Set(viKeys);

    const missingInVi = enKeys.filter(key => !viKeySet.has(key));
    const missingInEn = viKeys.filter(key => !enKeySet.has(key));

    if (missingInVi.length > 0 || missingInEn.length > 0) {
      hasError = true;
      console.error(`i18n key drift in ${file}:`);
      if (missingInVi.length > 0) {
        console.error(`  en has [${missingInVi.join(', ')}], vi is missing them`);
      }
      if (missingInEn.length > 0) {
        console.error(`  vi has [${missingInEn.join(', ')}], en is missing them`);
      }
    }
  }

  if (hasError) {
    process.exit(1);
  }

  console.log('✅ i18n parity check passed');
  process.exit(0);
}

checkParity();
