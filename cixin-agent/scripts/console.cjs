// Local operator entry point; credentials are only printed to this terminal.
const { randomBytes } = require('node:crypto');
const { resolve } = require('node:path');
const { loadConfig } = require('../dist/runtime/config');

const config = loadConfig(resolve(process.argv[2] ?? 'config/host.example.json'));
if (!process.env[config.tokenEnv]) process.env[config.tokenEnv] = randomBytes(32).toString('hex');
console.log(`Console token (${config.tokenEnv}): ${process.env[config.tokenEnv]}`);
require('../dist/cli');
