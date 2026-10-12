import {copyFiles} from './copy.mjs';
import fs from 'fs';
import path from 'path';
import {listTemplates, PAGE, SITE_EXCLUDED_FOLDERS, SITE_EXTENSIONS, SITE_FILES, SITE_FOLDERS} from './web-site.mjs';

// Two packs:
//   npm run pack      the Foundry module, into dist/
//   npm run pack:web  the web version's site, into dist-web/ (see web-site.mjs for what it holds)
const isWeb = process.argv.includes('--web');

// design/ holds internal work (prototypes, harnesses, notes). A local pack keeps it, because the
// test Foundry runs the module from dist/ and the prototypes are opened from there. A release
// pack (CI is set on GitHub Actions) leaves it out, so the release zip never carries it even
// though the folder is also gitignored and absent from a CI checkout.
const isRelease = Boolean(process.env.CI);

// The web page, the web host's services (src/platform/web) and the libraries Foundry already
// provides (PixiJS and Handlebars) are for the web version only
const excludedFolders = ['dist', 'dist-web', 'node_modules', '.git', '.github', 'scripts', 'tests', 'wiki', 'web', 'pixi', 'handlebars'];
if (isRelease) excludedFolders.push('design');

function resetFolder(folder) {
  if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true });
  fs.mkdirSync(folder, { recursive: true });
}

async function packModule() {
  resetFolder('./dist');
  await copyFiles(
    '.',
    './dist',
    ['js', 'mjs', 'json', 'css', 'hbs', 'svg', 'md', 'html'],
    [],
    excludedFolders,
    ['package.json', 'package-lock.json', 'GEMINI.md', '.DS_Store', '.gitignore', '.gitattributes']
  );
}

// The site keeps the repository's layout, so the page and the module code find each other by the
// same relative paths as in the working copy; the page itself is served at the site's root
async function packWeb() {
  const out = './dist-web';
  resetFolder(out);
  for (const folder of SITE_FOLDERS) {
    await copyFiles(folder, path.join(out, folder), SITE_EXTENSIONS, [], SITE_EXCLUDED_FOLDERS, ['.DS_Store']);
  }
  for (const file of SITE_FILES) fs.copyFileSync(file, path.join(out, file));
  fs.copyFileSync(PAGE, path.join(out, 'index.html'));
  fs.rmSync(path.join(out, PAGE));
  fs.writeFileSync(path.join(out, 'templates.json'), JSON.stringify(listTemplates('.')));
}

(isWeb ? packWeb() : packModule())
.then(() => {
  console.log(`${isWeb ? 'Web' : 'Module'} pack completed successfully!`);
})
.catch((error) => {
  console.error('Error during the pack:', error);
  process.exit(1);
});
