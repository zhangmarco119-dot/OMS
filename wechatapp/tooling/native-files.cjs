exports.installNativeFiles = (window, document, wx) => {
  const originalCreate = document.createElement.bind(document);
  const fs = wx.getFileSystemManager();
  let nextFile = 0;
  const read = filePath => new Promise((resolve,reject) => fs.readFile({filePath,success:result=>resolve(result.data),fail:reject}));
  const failure = error => {if(!/cancel/i.test(error?.errMsg || ''))wx.showToast({title:error?.message || '文件操作未完成，请重试',icon:'none'});};
  const choose = async input => {
    if(input.disabled || input.__choosing)return;
    input.__choosing = true;
    try {
      const accept = input.getAttribute('accept') || '';
      const images = accept.includes('image');
      const count = input.hasAttribute('multiple') ? 9 : 1;
      const capture = input.getAttribute('capture');
      const result = await new Promise((resolve,reject) => {
        if(images)wx.chooseMedia({count,mediaType:['image'],sourceType:capture?['camera']:['album','camera'],success:resolve,fail:reject});
        else wx.chooseMessageFile({count,type:'file',success:resolve,fail:reject});
      });
      const files = await Promise.all(result.tempFiles.map(async item => {
        const filePath = item.tempFilePath || item.path;
        const name = item.name || filePath.split('/').pop() || '照片.jpg';
        const extension = name.split('.').pop().toLowerCase();
        const type = images ? ({png:'image/png',webp:'image/webp',heic:'image/heic'}[extension] || 'image/jpeg') : ({xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',pdf:'application/pdf'}[extension] || 'application/octet-stream');
        const file = new window.File([await read(filePath)],name,{type});
        file.nativePath = filePath;
        return file;
      }));
      Object.defineProperty(input,'files',{configurable:true,value:Object.assign(files,{item:index=>files[index] || null})});
      input.dispatchEvent(new window.CustomEvent('change',{bubbles:true}));
    } catch(error) {failure(error);} finally {input.__choosing=false;}
  };
  const download = anchor => {
    const url = anchor.href;
    const name = (anchor.download || anchor.getAttribute('download') || 'StoreHub导出').replace(/[\\/:*?"<>|]/g,'_');
    const target = wx.env.USER_DATA_PATH+'/storehub-export-'+(++nextFile)+'-'+name;
    // Copy synchronously: shared browser handlers revoke their object URL as
    // soon as click returns. The native viewer must own a different file.
    let local = false;
    if(url?.startsWith(wx.env.USER_DATA_PATH+'/')) {fs.copyFileSync(url,target);local=true;}
    const prepare = local ? Promise.resolve(target) : window.fetch(url).then(response=>{if(!response.ok)throw new Error('导出文件下载失败');return response.arrayBuffer();}).then(data=>{fs.writeFileSync(target,data);return target;});
    prepare.then(filePath => {
      if(/\.(png|jpe?g|webp)$/i.test(name))wx.previewImage({urls:[filePath],current:filePath,fail:failure});
      else if(/\.(pdf|xlsx?|docx?|pptx?)$/i.test(name))wx.openDocument({filePath,showMenu:true,fail:failure});
      else if(wx.shareFileMessage)wx.shareFileMessage({filePath,fileName:name,fail:failure});
      else wx.showToast({title:'当前微信版本不支持打开此文件',icon:'none'});
    }).catch(failure);
  };
  document.createElement = (name, ...args) => {
    const node = originalCreate(name,...args);
    if(String(name).toLowerCase()==='input') {
      const click = node.click?.bind(node);
      node.click = () => node.type==='file'?choose(node):click?.();
    }
    if(String(name).toLowerCase()==='a') {
      const click = node.click?.bind(node);
      node.click = () => node.download || node.hasAttribute('download') ? download(node) : click ? click() : window.location.assign(node.href);
    }
    return node;
  };
  document.addEventListener('click', event => {
    let target=event.target;
    while(target && target!==document) {
      if(target.tagName==='INPUT' && target.type==='file') {event.preventDefault();choose(target);return;}
      if(target.tagName==='LABEL') {
        const id=target.getAttribute('for');
        const input=id?document.getElementById(id):target.querySelector('input');
        if(input?.type==='file'){event.preventDefault();choose(input);return;}
      }
      target=target.parentNode;
    }
  },true);
  window.__storehubCompressImage = async file => {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('只支持 JPG、PNG 或 WEBP 图片。');
    if(file.size<=0 || file.size>20*1024*1024)throw new Error('请选择 20 MB 以内的非空图片。');
    const source=file.nativePath || window.URL.createObjectURL(file);
    const invoke=(method,options)=>new Promise((resolve,reject)=>wx[method]({...options,success:resolve,fail:reject}));
    try {
      const info=await invoke('getImageInfo',{src:source});
      const scale=Math.min(1,2000/Math.max(info.width,info.height));
      const width=Math.max(1,Math.round(info.width*scale)),height=Math.max(1,Math.round(info.height*scale));
      let compressed;
      for(const quality of [82,60,40]){
        const result=await invoke('compressImage',{src:source,quality,compressedWidth:width,compressedHeight:height});
        const bytes=await read(result.tempFilePath);
        const actual=await invoke('getImageInfo',{src:result.tempFilePath});
        const mimeType=actual.type==='png'?'image/png':actual.type==='webp'?'image/webp':'image/jpeg';
        compressed={blob:new window.Blob([bytes],{type:mimeType}),width:actual.width,height:actual.height,mimeType};
        if(compressed.blob.size<=3*1024*1024)return compressed;
      }
      throw new Error('图片压缩后仍超过小程序上传限制，请降低相机分辨率后重试。');
    } finally {if(!file.nativePath)window.URL.revokeObjectURL(source);}
  };
};
