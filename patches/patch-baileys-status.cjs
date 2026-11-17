'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXPECTED_BAILEYS_VERSION = '7.0.0-rc.9';
const MARKER = '/* lucy-flow-lab: acknowledge top-level status stanzas */';

const packageRoot = path.resolve(__dirname, '..', 'node_modules', 'baileys');
const packageJsonPath = path.join(packageRoot, 'package.json');
const targetPath = path.join(packageRoot, 'lib', 'Socket', 'messages-recv.js');

if (!fs.existsSync(packageJsonPath) || !fs.existsSync(targetPath)) {
  throw new Error('[status-ack-patch] Baileys package files were not found. Refusing to continue.');
}

const installedVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
if (installedVersion !== EXPECTED_BAILEYS_VERSION) {
  throw new Error(
    `[status-ack-patch] Expected Baileys ${EXPECTED_BAILEYS_VERSION}, found ${installedVersion}. Review the patch before upgrading Baileys.`
  );
}

const original = fs.readFileSync(targetPath, 'utf8');

const requiredMarkers = [
  MARKER,
  'const handleStatus = async (node) => {',
  "['status', handleStatus]",
  "ws.on('CB:status'",
  "onUnexpectedError(error, 'processing offline node')"
];

if (original.includes(MARKER)) {
  const missing = requiredMarkers.filter(marker => !original.includes(marker));
  if (missing.length) {
    throw new Error(
      `[status-ack-patch] A partial patch was found. Missing: ${missing.join(', ')}. Refusing to continue.`
    );
  }

  console.log('[status-ack-patch] Patch is already applied and verified.');
  process.exit(0);
}

function replaceExactlyOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(
      `[status-ack-patch] Expected one match for "${label}", found ${count}. No file changes were written.`
    );
  }

  return source.replace(anchor, replacement);
}

let patched = original;

patched = replaceExactlyOnce(
  patched,
  '    const handleNotification = async (node) => {',
  `    ${MARKER}
    const handleStatus = async (node) => {
        try {
            await sendMessageAck(node);
        }
        catch (error) {
            onUnexpectedError(error, 'acking status stanza');
        }
    };
    const handleNotification = async (node) => {`,
  'handleNotification declaration'
);

patched = replaceExactlyOnce(
  patched,
  "            ['notification', handleNotification]\n        ]);",
  "            ['notification', handleNotification],\n            ['status', handleStatus]\n        ]);",
  'offline node processor map'
);

patched = replaceExactlyOnce(
  patched,
  '                    await nodeProcessor(node);',
  `                    try {
                        await nodeProcessor(node);
                    }
                    catch (error) {
                        onUnexpectedError(error, 'processing offline node');
                    }`,
  'offline node processor error handling'
);

patched = replaceExactlyOnce(
  patched,
  "    ws.on('CB:notification', async (node) => {\n        await processNode('notification', node, 'handling notification', handleNotification);\n    });",
  `    ws.on('CB:notification', async (node) => {
        await processNode('notification', node, 'handling notification', handleNotification);
    });
    ws.on('CB:status', async (node) => {
        await processNode('status', node, 'acking status stanza', handleStatus);
    });`,
  'CB:status event handler'
);

for (const marker of requiredMarkers) {
  if (!patched.includes(marker)) {
    throw new Error(`[status-ack-patch] Post-patch verification failed: missing "${marker}".`);
  }
}

fs.writeFileSync(targetPath, patched, 'utf8');

const syntaxCheck = spawnSync(process.execPath, ['--check', targetPath], {
  encoding: 'utf8'
});

if (syntaxCheck.error || syntaxCheck.status !== 0) {
  fs.writeFileSync(targetPath, original, 'utf8');
  const detail = syntaxCheck.stderr || syntaxCheck.error?.message || 'unknown syntax-check failure';
  throw new Error(`[status-ack-patch] Syntax check failed. Original file restored. ${detail}`);
}

console.log(
  '[status-ack-patch] Applied and syntax-checked: status stanzas are acknowledged, included in offline processing and isolated from offline queue failures.'
);
