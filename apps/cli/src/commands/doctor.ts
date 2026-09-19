import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NvidiaAdapter } from '@moderado/providers';
import { CliParsedArgs } from '../args.js';
import { getActiveConnection, loadConfig, migrateLegacyCredentials, resolveApiKey } from '../config.js';
import { WindowsCredentialStore } from '../windows_credentials.js';

export async function handleDoctorCommand(args: CliParsedArgs): Promise<number> {
  if (args.migrateCredentials) {
    if (process.platform !== 'win32') { process.stderr.write('Credential migration is available only on Windows. Use provider environment variables on this platform.\n'); return 1; }
    try { process.stdout.write(`Migrated ${await migrateLegacyCredentials(new WindowsCredentialStore())} credential(s) to Windows Credential Manager.\n`); }
    catch { process.stderr.write('Credential migration failed. Legacy configuration was preserved.\n'); return 1; }
  }
  const rows: [string, string, string][] = [];
  const add = (name: string, status: string, message: string): void => { rows.push([status, name, message]); };
  add('Node', parseInt(process.versions.node) >= 20 ? 'PASS' : 'FAIL', process.version);
  try { fs.accessSync(path.resolve(args.workspace), fs.constants.R_OK); add('Workspace', 'PASS', path.resolve(args.workspace)); } catch { add('Workspace', 'FAIL', 'Workspace is not readable.'); }
  const config = loadConfig();
  add('Provider', config.activeConnectionId || resolveApiKey() ? 'PASS' : 'WARN', config.activeConnectionId ? 'Configured' : 'No provider configured');
  add('API key', resolveApiKey() || config.apiKey ? 'PASS' : 'WARN', 'Configured value hidden');
  for (const command of ['git', 'npm']) { try { execFileSync(command, ['--version'], { stdio: 'ignore', windowsHide: true }); add(command, 'PASS', 'Available'); } catch { add(command, 'WARN', 'Not available'); } }
  if (args.connectivity) { const connection = getActiveConnection(config); if (!connection) add('Connectivity', 'FAIL', 'No active provider is configured.'); else { try { const models = await new NvidiaAdapter({ apiKey: connection.apiKey, baseUrl: connection.baseUrl, providerId: connection.id, providerName: connection.displayName }).discoverModels(); add('Connectivity', models.length ? 'PASS' : 'WARN', models.length ? `${models.length} models discovered` : 'Provider returned no models.'); } catch { add('Connectivity', 'FAIL', 'Provider catalog could not be reached.'); } } }
  for (const [status, name, message] of rows) process.stdout.write(`${status.padEnd(4)} ${name}: ${message}\n`);
  return rows.some(([status]) => status === 'FAIL') ? 1 : 0;
}
