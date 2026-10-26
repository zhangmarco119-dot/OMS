const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),rootRequire=createRequire(path.join(root,'package.json'));
const webpack=require('webpack'),MpPlugin=require('mp-webpack-plugin'),MiniCssExtractPlugin=require('mini-css-extract-plugin');
const esbuild=createRequire(rootRequire.resolve('vite'))('esbuild');
const environment=process.argv.includes('--production')?'production':'development';
const output=path.join(root,'wechatapp/build/'+environment);
const policy=rootRequire('./config/environment-policy.json');
const appEnv=require('./native-build-environment.cjs').validateNativeConfig(JSON.parse(fs.readFileSync(path.join(root,'wechatapp/.local',environment+'.json.local'),'utf8')),policy,environment);
const origin=policy[environment+'SelfHosted'].url.replace('/backend','');
const nativeConfig={origin,envId:'storehub-development-d7a8968dc20',functionName:'storehub-'+environment+'-api'};
const define=require('./native-globals.cjs').createNativeGlobals();
define['import.meta.env']=JSON.stringify(appEnv);define['process.env.NODE_ENV']='"production"';define.__STOREHUB_RELEASE__=JSON.stringify({version:rootRequire('./package.json').version,environment,databaseContract:1,buildId:'wechat-native',builtAt:new Date().toISOString()});
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await require('./build-styles.cjs').buildStyles();
  await new Promise((resolve,reject)=>webpack({mode:'production',devtool:false,context:root,entry:{launch:path.join(__dirname,'split-launch.tsx'),workspace:path.join(__dirname,'split-workspace.tsx')},output:{path:path.join(output,'common'),filename:'[name].js',library:'createApp',libraryExport:'default',libraryTarget:'window',globalObject:'window'},target:'web',resolve:{alias:{'react/jsx-runtime$':path.join(__dirname,'native-jsx-runtime.ts'),'storehub-original-jsx-runtime':rootRequire.resolve('react/jsx-runtime')},extensions:['.tsx','.ts','.mjs','.js','.json'],modules:[path.join(root,'node_modules'),path.join(__dirname,'node_modules'),'node_modules']},optimization:{runtimeChunk:false,splitChunks:{chunks:'all',minSize:1000,cacheGroups:{vendors:{test:/[\\/]node_modules[\\/]/,name:'vendors',chunks:'all',enforce:true},styles:{name:'styles',type:'css/mini-extract',chunks:'all',enforce:true},default:{minChunks:2,reuseExistingChunk:true,name:'shared'}}}},module:{parser:{javascript:{dynamicImportMode:"eager"}},rules:[{test:/\.[cm]?[jt]sx?$/,use:{loader:path.join(__dirname,'esbuild-mini-loader.cjs'),options:{define}}},{test:/\.css$/,use:[MiniCssExtractPlugin.loader,require.resolve('css-loader')]}]},plugins:[new webpack.DefinePlugin({'process.env.NODE_ENV':'"production"'}),new MiniCssExtractPlugin({filename:'[name].wxss'}),new MpPlugin({origin,entry:'/login',runtime:{localStorage:'persistent',extraStyleList:require('./native-styles.cjs').extraStyleList},router:{launch:['/login','/'],workspace:['/app','/app/(.*)']},generate:{subpackages:{workspace:['workspace']}},redirect:{notFound:'launch',accessDenied:'launch'},pages:{launch:{defaultTargetUrl:'/login',windowScroll:true},workspace:{defaultTargetUrl:'/app',windowScroll:true}},app:{navigationBarTitleText:environment==='production'?'StoreHub 正式系统验证':'StoreHub 测试系统验证'},projectConfig:{appid:'wxa11bc5cac53d2291',projectname:environment==='production'?'StoreHub-production-probe':'StoreHub-split-probe',libVersion:'3.17.5',setting:{urlCheck:true,es6:true,enhance:true,minified:true,nodeModules:true}}})]},(error,stats)=>{if(error)return reject(error);if(stats.hasErrors())return reject(new Error(stats.toString({all:false,errors:true})));console.log(stats.toString({all:false,assets:true}));resolve();}));
  await esbuild.build({entryPoints:[path.join(__dirname,'native-setup.ts')],outfile:path.join(output,'common/native-runtime.js'),bundle:true,format:'cjs',target:'es2019',minify:true,platform:'browser',define:{__STOREHUB_MINIPROGRAM__:JSON.stringify(nativeConfig)},nodePaths:[path.join(__dirname,'node_modules')],logLevel:'warning'});
  await require('./build-intl.cjs').buildIntl(path.join(output,'intl/runtime.js'));
  const intlPage=path.join(output,'intl/pages/bootstrap');
  fs.mkdirSync(intlPage,{recursive:true});
  fs.writeFileSync(path.join(intlPage,'index.js'),'Page({});\n');
  fs.writeFileSync(path.join(intlPage,'index.json'),'{}');
  fs.writeFileSync(path.join(intlPage,'index.wxml'),'<view>正在准备系统</view>');
  const appPath=path.join(output,'app.json'),app=JSON.parse(fs.readFileSync(appPath,'utf8'));
  app.subpackages.push({name:'intl',root:'intl',pages:['pages/bootstrap/index']});
  fs.writeFileSync(appPath,JSON.stringify(app,null,2));
  for(const relative of ['pages/base.js','workspace/pages/base.js']) {
    const basePath=path.join(output,relative),base=fs.readFileSync(basePath,'utf8');
    if(!base.includes('init(this.window, this.document)'))throw new Error('Kbone page initialization template changed');
    const runtimePath=relative.startsWith('workspace/')?'../../common/native-runtime.js':'../common/native-runtime.js';
    const intlPath=relative.startsWith('workspace/')?'../../intl/runtime.js':'../intl/runtime.js';
    fs.writeFileSync(basePath,base.replace('init(this.window, this.document)',"require('"+runtimePath+"').install(this.window, this.document);\n                this.window.__storehubIntlReady = require.async('"+intlPath+"').then(module => module.install(this.window));\n                init(this.window, this.document)"));
  }
  for(const name of ['miniprogram-render','miniprogram-element'])fs.cpSync(path.join(__dirname,'node_modules',name,'dist'),path.join(output,'miniprogram_npm',name),{recursive:true});
  const eventFile=path.join(output,'miniprogram_npm/miniprogram-element/base.js');
  fs.writeFileSync(eventFile,require('./kbone-event-patch.cjs').patchSubmitBubbling(fs.readFileSync(eventFile,'utf8')));
  const sizes={main:0,workspace:0,intl:0};
  function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,entry.name);if(entry.isDirectory()){if(entry.name!=='node_modules')walk(full);}else if(!entry.name.endsWith('.map')){const relative=path.relative(output,full).replaceAll('\\','/');sizes[relative.startsWith('workspace/')?'workspace':relative.startsWith('intl/')?'intl':'main']+=fs.statSync(full).size;}}}
  walk(output);fs.writeFileSync(path.join(output,'package-sizes.json'),JSON.stringify(sizes,null,2));console.log(JSON.stringify({output,sizes}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
