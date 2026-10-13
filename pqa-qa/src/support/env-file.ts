import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Sets KEY=value in a dotenv file (replacing any KEY= line), or removes it when value is undefined. Other lines stay as they are. */
export function setEnvLine(path: string, key: string, value: string | undefined): void {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const lines = text ? text.replace(/\n$/, '').split('\n').filter((l) => !l.startsWith(`${key}=`)) : [];
  if (value !== undefined) lines.push(`${key}=${value}`);
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '');
}
