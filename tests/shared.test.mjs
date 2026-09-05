import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePngDataUrl,
  etagMatches,
  pngDimensions,
  revisionEtag,
  sanitizeAndValidateSpecies,
  sanitizeBio,
  sanitizeName,
} from '../netlify/functions/_shared.mjs';

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test('PNG validation accepts exhibit-sized images and rejects pixel bombs', () => {
  assert.deepEqual(pngDimensions(pngHeader(900, 600)), { width: 900, height: 600 });
  const valid = `data:image/png;base64,${pngHeader(900, 600).toString('base64')}`;
  assert.equal(decodePngDataUrl(valid, { maxBytes: 1024 }).ok, true);
  const huge = `data:image/png;base64,${pngHeader(100000, 100000).toString('base64')}`;
  assert.equal(decodePngDataUrl(huge, { maxBytes: 1024 }).status, 413);
});

test('metadata sanitizers enforce display-safe bounds', () => {
  assert.equal(sanitizeName('  <Ada>   Reef!!  '), 'Ada Reef');
  assert.equal(sanitizeBio('x'.repeat(200)).length, 120);
  assert.equal(sanitizeAndValidateSpecies('shark1'), 'shark1');
  assert.equal(sanitizeAndValidateSpecies('made_up_fish'), '');
});

test('revision ETags support conditional polling', () => {
  const etag = revisionEtag('2026-09-03', 'abc');
  assert.match(etag, /^"fish-[A-Za-z0-9_-]+"$/);
  assert.equal(etagMatches(etag, etag), true);
  assert.equal(etagMatches('"something-else"', etag), false);
});
