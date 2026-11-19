// Builds the unpacked extension into dist/.
import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: {
    background: 'src/background.ts',
    popup: 'src/popup.ts',
    menu: 'src/menu.ts',
    content: 'src/content/content.ts',
    inline: 'src/content/inline.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  legalComments: 'inline',
  logLevel: 'warning',
});

for (const file of ['manifest.json', 'popup.html', 'menu.html', 'ui.css', 'icons']) cpSync(file, `dist/${file}`, { recursive: true });
