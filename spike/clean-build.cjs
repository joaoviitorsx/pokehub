const { rmSync } = require('node:fs');
const { resolve } = require('node:path');
function cleanBuild(output) { rmSync(output,{recursive:true,force:true}); }
if (require.main === module) cleanBuild(resolve(__dirname,'../dist-electron'));
module.exports = { cleanBuild };
