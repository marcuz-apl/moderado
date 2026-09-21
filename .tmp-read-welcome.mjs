const fs = require('fs');
const c = fs.readFileSync('d:/projects/moderado/apps/cli/src/ui/welcome.ts', 'utf8');
const lines = c.split('\n');
console.log('TOTAL LINES: ' + lines.length);
console.log('=== LINES 900-980 ===');
lines.slice(899, 980).forEach((l, i) => console.log((i + 900) + ': ' + l));
