#!/usr/bin/env node
/** CLI is one caller of the same native operation consumed by MetroPlat. */
import { readFile } from 'node:fs/promises';
import { dispatchPublicTestCompute } from '../src/dispatch.mjs';
import { MAX_PATCH_BYTES } from '../src/admission.mjs';
const [targetRepository, targetCommit, patchPath, ...extra] = process.argv.slice(2);
if (!targetRepository || !targetCommit || extra.length)
  throw new Error('usage: dispatch-public-test-compute OWNER/REPO 40_HEX_COMMIT [PATCH_FILE]');
const patch = patchPath ? await readFile(patchPath) : Buffer.alloc(0);
if (patch.length > MAX_PATCH_BYTES) throw new Error(`patch exceeds ${MAX_PATCH_BYTES} bytes`);
const result = await dispatchPublicTestCompute({targetRepository,targetCommit,patchBase64:patch.toString('base64')});
process.stdout.write(`${JSON.stringify(result)}\n`);
