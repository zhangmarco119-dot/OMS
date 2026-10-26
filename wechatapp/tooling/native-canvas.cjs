exports.installNativeCanvas=(window,document,wx)=>{
  const create=document.createElement.bind(document);
  document.createElement=(name,...args)=>{
    const node=create(name,...args);
    if(String(name).toLowerCase()!=='canvas')return node;
    const canvas=wx.createOffscreenCanvas({type:'2d',width:300,height:150});
    for(const axis of ['width','height'])Object.defineProperty(node,axis,{configurable:true,get:()=>canvas[axis],set:value=>{canvas[axis]=Math.max(0,Math.floor(Number(value)||0));}});
    node.getContext=type=>canvas.getContext(type);
    node.toDataURL=(...options)=>canvas.toDataURL(...options);
    node.toBlob=(callback,type='image/png',quality)=>{
      Promise.resolve().then(()=>{
        const url=canvas.toDataURL(type,quality),match=/^data:([^;,]+);base64,(.+)$/.exec(url);
        if(!match)throw new Error('图表生成失败');
        callback(new window.Blob([wx.base64ToArrayBuffer(match[2])],{type:match[1]}));
      }).catch(()=>callback(null));
    };
    return node;
  };
};
