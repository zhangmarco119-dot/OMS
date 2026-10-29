const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), { createRequire } = require('node:module');
const rootRequire = createRequire(path.join(__dirname, '../../package.json'));
const esbuild = createRequire(rootRequire.resolve('vite'))('esbuild');
exports.buildIntl = outfile => {
  let tzData;
  vm.runInNewContext(fs.readFileSync(require.resolve('@formatjs/intl-datetimeformat/add-golden-tz.js'), 'utf8'), { Intl: { DateTimeFormat: { __addTZData: data => { tzData = data; } } } });
  const shanghai = tzData.zones.filter(zone => zone.startsWith('Asia/Shanghai|'));
  if (shanghai.length !== 1) throw new Error('Shanghai timezone dataset changed');
  fs.writeFileSync(path.join(__dirname, 'native-intl-timezones.generated.js'), 'if(typeof Intl.DateTimeFormat.__addTZData === "function") Intl.DateTimeFormat.__addTZData('+JSON.stringify({ ...tzData, zones: shanghai })+');\n');
  return esbuild.build({ entryPoints: [path.join(__dirname, 'native-intl.ts')], outfile, bundle: true, format: 'cjs', minify: true, platform: 'browser', target: 'es2020', nodePaths: [path.join(__dirname, 'node_modules')], define: { Intl: '__storehubIntl' }, banner: { js: 'var __storehubIntl = globalThis.Intl || (globalThis.Intl = {});' }, logLevel: 'warning' });
};
if (require.main === module) exports.buildIntl(path.join(__dirname, '../wechat-intl-size-probe.js')).then(() => console.log(require('node:fs').statSync(path.join(__dirname, '../wechat-intl-size-probe.js')).size)).catch(error => { console.error(error.message); process.exitCode = 1; });
