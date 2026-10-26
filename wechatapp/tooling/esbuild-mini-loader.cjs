const {createRequire}=require('node:module');
const esbuild=createRequire(require.resolve('vite'))('esbuild');
const fs=require('node:fs'),path=require('node:path');
module.exports=function(source){
  const callback=this.async();const extension=this.resourcePath.split('.').pop();
  const options=this.getOptions();
  if(/[\\/]src[\\/]/.test(this.resourcePath) && !/[\\/]node_modules[\\/]/.test(this.resourcePath))source=require('./native-source-transform.cjs').transformNativeSource(source,this.resourcePath);
  let loader=extension==='tsx'?'tsx':extension==='ts'?'ts':'jsx';
  if(/[\\/]lucide-react[\\/]dist[\\/]esm[\\/]Icon\.js$/.test(this.resourcePath)){
    const replacement=path.join(__dirname,'native-lucide.tsx');this.addDependency(replacement);
    source=fs.readFileSync(replacement,'utf8').replace("'./native-icon.cjs'",JSON.stringify(path.join(__dirname,'native-icon.cjs').replaceAll('\\','/')));loader='tsx';
  }
  // Preserve each dependency's module format so require('react') returns React,
  // rather than an ESM namespace containing React under `default`.
  esbuild.transform(source,{loader,jsx:'automatic',target:'es2019',define:options.define,sourcefile:this.resourcePath}).then(result=>callback(null,result.code),callback);
};
