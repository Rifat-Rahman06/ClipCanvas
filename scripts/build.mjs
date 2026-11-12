import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context as esbuildContext, build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { generateIcons } from './make-icons.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const banner = watch ? undefined : '/* ClipCanvas — local-first research notebook */';

function log(message) {
  console.log(`[clipcanvas] ${message}`);
}

async function copyManifest() {
  const source = path.join(root, 'chrome', 'manifest.json');
  const raw = await readFile(source, 'utf8');
  const manifest = JSON.parse(raw);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    throw new Error(
      `Manifest version ${manifest.version} does not match package version ${pkg.version}.`,
    );
  }
  await writeFile(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyStatic() {
  // Vite handles public/ automatically; this is here for any future non-public
  // extension assets that need to land at the dist root.
  const assets = path.join(root, 'chrome', 'assets');
  try {
    await cp(assets, path.join(dist, 'assets'), { recursive: true });
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
}

const sharedEsbuild = {
  bundle: true,
  target: 'chrome116',
  platform: 'browser',
  charset: 'utf8',
  legalComments: 'none',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  banner: banner ? { js: banner } : undefined,
  logLevel: 'info',
};

async function buildBackground({ watchMode = false } = {}) {
  const options = {
    ...sharedEsbuild,
    entryPoints: [path.join(root, 'src', 'background', 'service-worker.ts')],
    outfile: path.join(dist, 'background.js'),
    format: 'esm',
  };
  if (!watchMode) return esbuild(options);
  const ctx = await esbuildContext(options);
  await ctx.watch();
  return ctx;
}

async function buildContent({ watchMode = false } = {}) {
  const options = {
    ...sharedEsbuild,
    entryPoints: [path.join(root, 'src', 'content', 'selection.ts')],
    outfile: path.join(dist, 'content.js'),
    format: 'iife',
  };
  if (!watchMode) return esbuild(options);
  const ctx = await esbuildContext(options);
  await ctx.watch();
  return ctx;
}

async function buildUi({ watchMode = false } = {}) {
  await viteBuild({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    build: {
      emptyOutDir: !watchMode,
      watch: watchMode ? {} : null,
    },
  });
}

async function main() {
  await rm(dist, { recursive: true, force: true });

  log('generating icons');
  await generateIcons();

  log('building side panel UI');
  await buildUi({ watchMode: watch });

  log('bundling background and content scripts');
  const bundles = await Promise.all([
    buildBackground({ watchMode: watch }),
    buildContent({ watchMode: watch }),
  ]);

  await copyManifest();
  await copyStatic();

  log(`output written to ${path.relative(root, dist)}`);

  if (watch) {
    log('watching background.js and content.js — rebuild the UI with Vite on change');
    await new Promise(() => {
      // Keep the process alive; esbuild contexts own their watchers.
      void bundles;
    });
  }
}

main().catch((error) => {
  console.error('[clipcanvas] build failed');
  console.error(error);
  process.exitCode = 1;
});
