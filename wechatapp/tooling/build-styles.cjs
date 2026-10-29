const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),rootRequire=createRequire(path.join(root,'package.json'));
exports.buildStyles=async()=>{
  const postcss=rootRequire('postcss'),tailwind=rootRequire('tailwindcss');
  const selectorParser=createRequire(rootRequire.resolve('tailwindcss'))('postcss-selector-parser');
  const result=await postcss([tailwind({config:path.join(root,'tailwind.config.ts'),content:[path.join(root,'src/**/*.{ts,tsx}').replaceAll('\\','/')]})]).process(fs.readFileSync(path.join(root,'src/styles.css'),'utf8'),{from:path.join(root,'src/styles.css')});
  const tree=postcss.parse(result.css.replaceAll('100dvh','100vh'));
  tree.walkRules(rule=>{
    rule.selector=rule.selector.replace(/>\s*\*?:not\(\[hidden\]\)\s*~\s*:not\(\[hidden\]\)/g,'>:not([hidden]):not(:first-child)');
    rule.selector=selectorParser(selectors=>selectors.walkClasses(node=>{
      if(!/^[a-zA-Z0-9_-]+$/.test(node.value)){
        node.value=`twx_${Array.from(node.value).map(char=>char.codePointAt(0).toString(16)).join('_')}`;
        node.raws={};
      }
    })).processSync(rule.selector);
  });
  fs.writeFileSync(path.join(__dirname,'styles.generated.css'),tree.toString());
};
