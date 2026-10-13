// Metro does not drop unused exports, so `import { Camera } from 'lucide-react-native'` brings all
// ~1,900 icons into the app (about a quarter of the JavaScript the phone must load at start).
// This rewrites each named icon import to its own file: `import Camera from 'lucide-react-native/icons/camera'`.
// Names are looked up in the package's own icon index; anything not found is left as it was.
const fs = require('fs');
const path = require('path');

let names;
function iconFiles() {
  if (names) return names;
  names = new Map();
  try {
    const pkg = path.dirname(require.resolve('lucide-react-native', { paths: [__dirname] }));
    let dir = pkg;
    while (!fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
    // The package's entry lists every name and alias with its file:
    // export { default as CheckCircle, default as CircleCheckBig, … } from './icons/circle-check-big.mjs';
    const index = fs.readFileSync(path.join(dir, 'dist', 'esm', 'lucide-react-native.mjs'), 'utf8');
    for (const m of index.matchAll(/export \{([^}]+)\} from '\.\/icons\/([a-z0-9-]+)\.mjs'/g)) {
      for (const part of m[1].split(',')) {
        const alias = part.trim().match(/^default as (\w+)$/);
        if (alias) names.set(alias[1], m[2]);
      }
    }
  } catch {
    // No index: leave every import alone.
  }
  return names;
}

module.exports = function lucidePerIcon({ types: t }) {
  return {
    name: 'lucide-per-icon',
    visitor: {
      ImportDeclaration(p) {
        if (p.node.source.value !== 'lucide-react-native' || p.node.importKind === 'type') return;
        const files = iconFiles();
        const keep = [];
        const perIcon = [];
        for (const s of p.node.specifiers) {
          const file = t.isImportSpecifier(s) && s.importKind !== 'type' && t.isIdentifier(s.imported) ? files.get(s.imported.name) : undefined;
          if (file) perIcon.push(t.importDeclaration([t.importDefaultSpecifier(t.identifier(s.local.name))], t.stringLiteral(`lucide-react-native/icons/${file}`)));
          else keep.push(s);
        }
        if (!perIcon.length) return;
        if (keep.length) {
          p.node.specifiers = keep;
          p.insertAfter(perIcon);
        } else p.replaceWithMultiple(perIcon);
      },
    },
  };
};
