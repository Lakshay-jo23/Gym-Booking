const crypto = require('crypto');

// Check-in codes: 6 chars from a cryptographically secure RNG, so one code reveals nothing
// about another (32^6 ~ 1 billion). No 0/O/1/I so they are easy to read out at the door.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

module.exports = { makeCode, CODE_RE: /^[A-HJ-NP-Z2-9]{6}$/ };
