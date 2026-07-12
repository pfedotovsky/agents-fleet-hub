#!/usr/bin/env node
// Modified from CloudCLI 1.36.1 — see NOTICE.
// fleet-server CLI: start (default), status, help, version. Upstream's
// sandbox/browser-use-mcp/update subcommands were removed with their features;
// version/paths come from build-time constants instead of package.json lookups.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { VERSION, PRODUCT_NAME, UPSTREAM_ATTRIBUTION } from './shared/build-info.js';
import { getFleetServerHome, getDefaultDatabasePath } from './load-env.js';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

function getDatabasePath() {
    return process.env.DATABASE_PATH || getDefaultDatabasePath();
}

function showStatus() {
    console.log(`\n${c.bright(`${PRODUCT_NAME} - Status`)}\n`);
    console.log(c.dim('═'.repeat(60)));

    console.log(`\n${c.info('[INFO]')} Version: ${c.bright(VERSION)}`);
    console.log(`${c.dim(UPSTREAM_ATTRIBUTION)}`);

    const home = getFleetServerHome();
    console.log(`\n${c.info('[INFO]')} Data Directory:`);
    console.log(`       ${c.dim(home)}`);

    const dbPath = getDatabasePath();
    const dbExists = fs.existsSync(dbPath);
    console.log(`\n${c.info('[INFO]')} Database Location:`);
    console.log(`       ${c.dim(dbPath)}`);
    console.log(`       Status: ${dbExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not created yet (will be created on first run)')}`);

    if (dbExists) {
        const stats = fs.statSync(dbPath);
        console.log(`       Size: ${c.dim((stats.size / 1024).toFixed(2) + ' KB')}`);
        console.log(`       Modified: ${c.dim(stats.mtime.toLocaleString())}`);
    }

    console.log(`\n${c.info('[INFO]')} Configuration:`);
    console.log(`       SERVER_PORT: ${c.bright(process.env.SERVER_PORT || process.env.PORT || '3011')} ${c.dim(process.env.SERVER_PORT || process.env.PORT ? '' : '(default)')}`);
    console.log(`       HOST: ${c.dim(process.env.HOST || '0.0.0.0 (default)')}`);
    console.log(`       DATABASE_PATH: ${c.dim(process.env.DATABASE_PATH || '(using default location)')}`);
    console.log(`       CLAUDE_CLI_PATH: ${c.dim(process.env.CLAUDE_CLI_PATH || 'claude (default)')}`);
    console.log(`       CODEX_CLI_PATH: ${c.dim(process.env.CODEX_CLI_PATH || 'codex (default)')}`);
    console.log(`       CONTEXT_WINDOW: ${c.dim(process.env.CONTEXT_WINDOW || '160000 (default)')}`);

    const claudeProjectsPath = path.join(os.homedir(), '.claude', 'projects');
    const projectsExists = fs.existsSync(claudeProjectsPath);
    console.log(`\n${c.info('[INFO]')} Claude Projects Folder:`);
    console.log(`       ${c.dim(claudeProjectsPath)}`);
    console.log(`       Status: ${projectsExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not found')}`);

    const envFilePath = path.join(home, '.env');
    const envExists = fs.existsSync(envFilePath);
    console.log(`\n${c.info('[INFO]')} Configuration File:`);
    console.log(`       ${c.dim(envFilePath)}`);
    console.log(`       Status: ${envExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not found (using defaults)')}`);

    console.log('\n' + c.dim('═'.repeat(60)));
    console.log(`\n${c.tip('[TIP]')} Hints:`);
    console.log(`      ${c.dim('>')} Use ${c.bright('fleet-server --port 8080')} to run on a custom port`);
    console.log(`      ${c.dim('>')} Use ${c.bright('HOST=:: fleet-server')} on IPv6-only hosts`);
    console.log(`      ${c.dim('>')} Run ${c.bright('fleet-server help')} for all options\n`);
}

function showHelp() {
    console.log(`
${c.bright(PRODUCT_NAME)} — single-binary agent host server for Agents Hub
${c.dim(UPSTREAM_ATTRIBUTION)}

Usage:
  fleet-server [command] [options]

Commands:
  start            Start the server (default)
  status           Show configuration and data locations
  help             Show this help information
  version          Show version information

Options:
  -p, --port <port>           Set server port (default: 3011)
  --database-path <path>      Set custom database location
  -h, --help                  Show this help information
  -v, --version               Show version information

Environment Variables:
  SERVER_PORT         Set server port (default: 3011)
  HOST                Bind address (default: 0.0.0.0; use :: for IPv6-only hosts)
  DATABASE_PATH       Set custom database location
  FLEET_SERVER_HOME   Data directory (default: ~/.fleet-server)
  CLAUDE_CLI_PATH     Set custom Claude CLI path
  CODEX_CLI_PATH      Set custom Codex CLI path
  CONTEXT_WINDOW      Set context window size (default: 160000)
`);
}

function parseArgs(args) {
    const parsed = { command: 'start', options: {} };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--port' || arg === '-p') {
            parsed.options.serverPort = args[++i];
        } else if (arg.startsWith('--port=')) {
            parsed.options.serverPort = arg.split('=')[1];
        } else if (arg === '--database-path') {
            parsed.options.databasePath = args[++i];
        } else if (arg.startsWith('--database-path=')) {
            parsed.options.databasePath = arg.split('=')[1];
        } else if (arg === '--help' || arg === '-h') {
            parsed.command = 'help';
        } else if (arg === '--version' || arg === '-v') {
            parsed.command = 'version';
        } else if (!arg.startsWith('-')) {
            parsed.command = arg;
        }
    }

    return parsed;
}

async function main() {
    const args = process.argv.slice(2);
    const { command, options } = parseArgs(args);

    if (options.serverPort) {
        process.env.SERVER_PORT = options.serverPort;
    } else if (!process.env.SERVER_PORT && process.env.PORT) {
        process.env.SERVER_PORT = process.env.PORT;
    }
    if (options.databasePath) {
        process.env.DATABASE_PATH = options.databasePath;
    }

    switch (command) {
        case 'start':
            await import('./index.js');
            break;
        case 'status':
        case 'info':
            showStatus();
            break;
        case 'help':
            showHelp();
            break;
        case 'version':
            console.log(VERSION);
            break;
        default:
            console.error(`\n❌ Unknown command: ${command}`);
            console.log(`   Run "${PRODUCT_NAME} help" for usage information.\n`);
            process.exit(1);
    }
}

main().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
