// Tripwire test — guards against accidental deletion or rename of the
// commands block in unrelated edits. Does NOT prove the binding works in
// real Chrome; that requires manual verification at chrome://extensions/shortcuts.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf-8')
);

describe('manifest.json', () => {
  it('is manifest_version 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('declares the _execute_action command with the suggested default shortcut', () => {
    const cmd = manifest.commands?._execute_action;
    expect(cmd).toBeDefined();
    expect(cmd.suggested_key.default).toBe('Alt+Shift+S');
  });

  it('gives the _execute_action command a non-empty description', () => {
    const description = manifest.commands?._execute_action?.description;
    expect(typeof description).toBe('string');
    expect(description.length).toBeGreaterThan(0);
  });
});
