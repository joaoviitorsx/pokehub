const fs = require('node:fs');
fs.writeFileSync('dist-electron/package.json', '{"type":"commonjs"}\n');
