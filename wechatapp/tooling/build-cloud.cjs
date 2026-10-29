const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'wechatapp/build/cloudfunctions');
const functions=[];
for(const environment of ['development','production']){
  const name=`storehub-${environment}-api`,directory=path.join(output,name);
  fs.mkdirSync(directory,{recursive:true});
  for(const file of ['proxy.cjs','http-handler.cjs'])fs.copyFileSync(path.join(root,'wechatapp/cloudfunctions/bridge',file),path.join(directory,file));
  fs.writeFileSync(path.join(directory,'index.js'),"const http=require('node:http');const {createProxy}=require('./proxy.cjs');const {createHttpHandler}=require('./http-handler.cjs');const target=require('./target.json');http.createServer(createHttpHandler(createProxy({target,fetcher:fetch}))).listen(9000,'0.0.0.0');\n");
  fs.writeFileSync(path.join(directory,'target.json'),JSON.stringify({environment,origin:environment==='production'?'https://oms-store-management.pages.dev':'https://oms-store-development.pages.dev',appid:'wxa11bc5cac53d2291'}));
  fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name,private:true,version:'1.0.0',main:'index.js'}));
  fs.writeFileSync(path.join(directory,'scf_bootstrap'),'#!/bin/bash\ncd /var/user\nexec /var/lang/node20/bin/node index.js\n',{mode:0o755});
  functions.push({name,runtime:'Nodejs20.19',timeout:35,memorySize:128,installDependency:false});
}
fs.writeFileSync(path.join(output,'cloudbaserc.json'),JSON.stringify({envId:'storehub-development-d7a8968dc20',region:'ap-shanghai',functionRoot:'.',functions},null,2));
console.log(JSON.stringify({output,functions:functions.map(item=>item.name)}));
