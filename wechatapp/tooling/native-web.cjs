// Prototype runtime: exercised locally before it can replace the user's project.
const {TextEncoder,TextDecoder} = require('./native-utf8.cjs');
exports.installNativeWeb = (window, wx, config) => {
  const encoder=new TextEncoder(), decoder=new TextDecoder();
  const bytesOf=value=>value instanceof NativeBlob?value._bytes.slice():value instanceof ArrayBuffer?new Uint8Array(value.slice(0)):ArrayBuffer.isView(value)?new Uint8Array(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength)):encoder.encode(String(value));
  class NativeBlob {
    constructor(parts=[],options={}) {
      const chunks=parts.map(bytesOf);this._bytes=new Uint8Array(chunks.reduce((size,item)=>size+item.byteLength,0));
      let offset=0;for(const chunk of chunks){this._bytes.set(chunk,offset);offset+=chunk.byteLength;}
      this.type=typeof options.type==='string'?options.type.toLowerCase():'';
    }
    get size(){return this._bytes.byteLength;}
    async arrayBuffer(){return this._bytes.slice().buffer;}
    async text(){return decoder.decode(this._bytes);}
    slice(start=0,end=this.size,type=''){const clamp=n=>Math.min(this.size,Math.max(0,n<0?this.size+n:n));return new NativeBlob([this._bytes.slice(clamp(start),clamp(end))],{type});}
    get [Symbol.toStringTag](){return 'Blob';}
  }
  class NativeFile extends NativeBlob {
    constructor(parts,name,options={}){super(parts,options);this.name=String(name).replaceAll('/' ,'_');this.lastModified=options.lastModified??Date.now();}
    get [Symbol.toStringTag](){return 'File';}
  }
  class NativeHeaders {
    constructor(init={}){this._map=new Map();if(init instanceof NativeHeaders||Array.isArray(init))for(const [name,value]of init)this.append(name,value);else if(typeof init?.forEach==='function')init.forEach((value,name)=>this.append(name,value));else for(const [name,value]of Object.entries(init))this.append(name,value);}
    _name(name){name=String(name).toLowerCase();if(!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name))throw new TypeError('Invalid header name');return name;}
    _value(value){value=String(value).trim();if(/[\r\n\0]/.test(value))throw new TypeError('Invalid header value');return value;}
    get(name){return this._map.get(this._name(name))??null;}
    has(name){return this._map.has(this._name(name));}
    set(name,value){this._map.set(this._name(name),this._value(value));}
    append(name,value){name=this._name(name);value=this._value(value);this._map.set(name,this.has(name)?this.get(name)+', '+value:value);}
    delete(name){this._map.delete(this._name(name));}
    forEach(fn,thisArg){for(const [name,value]of this._map)fn.call(thisArg,value,name,this);}
    entries(){return this._map.entries();}keys(){return this._map.keys();}values(){return this._map.values();}
    [Symbol.iterator](){return this.entries();}
  }
  class NativeFormData {
    constructor(){this._parts=[];}
    append(name,value,filename){this._parts.push([String(name),value instanceof NativeBlob?value:String(value),filename]);}
    delete(name){this._parts=this._parts.filter(item=>item[0]!==String(name));}
    set(name,value,filename){this.delete(name);this.append(name,value,filename);}
    get(name){return this._parts.find(item=>item[0]===String(name))?.[1]??null;}
    getAll(name){return this._parts.filter(item=>item[0]===String(name)).map(item=>item[1]);}
    has(name){return this.get(name)!==null;}
    *entries(){for(const [name,value]of this._parts)yield[name,value];}
    [Symbol.iterator](){return this.entries();}
    toBlob(){
      const boundary='----StoreHub'+Date.now().toString(36)+Math.random().toString(36).slice(2);
      const safe=value=>String(value).replace(/[\r\n]/g,'').replaceAll('"','%22');
      const parts=[];
      for(const [name,value,filename]of this._parts){
        parts.push('--'+boundary+'\r\nContent-Disposition: form-data; name="'+safe(name)+'"');
        if(value instanceof NativeBlob){parts.push('; filename="'+safe(filename??value.name??'blob')+'"\r\nContent-Type: '+safe(value.type||'application/octet-stream')+'\r\n\r\n',value,'\r\n');}
        else parts.push('\r\n\r\n',value,'\r\n');
      }
      parts.push('--'+boundary+'--\r\n');return new NativeBlob(parts,{type:'multipart/form-data; boundary='+boundary});
    }
  }
  class NativeResponse {
    constructor(body=null,init={}){this.status=init.status??200;if(!Number.isInteger(this.status)||this.status<200||this.status>599)throw new RangeError('Invalid response status');this.statusText=init.statusText||'';this.headers=new NativeHeaders(init.headers);this.url=init.url||'';this.redirected=false;this.type='basic';this.bodyUsed=false;this._blob=body instanceof NativeBlob?body:new NativeBlob(body===null?[]:[body],{type:this.headers.get('content-type')||''});this.body={cancel:async()=>{this.bodyUsed=true;}};}
    get ok(){return this.status>=200&&this.status<300;}
    _consume(){if(this.bodyUsed)throw new TypeError('Body already used');this.bodyUsed=true;return this._blob;}
    async text(){return this._consume().text();}async json(){return JSON.parse(await this.text());}async arrayBuffer(){return this._consume().arrayBuffer();}async blob(){return this._consume();}
    clone(){if(this.bodyUsed)throw new TypeError('Body already used');return new NativeResponse(this._blob,{status:this.status,statusText:this.statusText,headers:this.headers,url:this.url});}
  }
  class NativeRequest {
    constructor(input,init={}){const old=input instanceof NativeRequest?input:null;this.url=new window.URL(old?old.url:String(input),window.location.origin).href;this.method=String(init.method??old?.method??'GET').toUpperCase();this.headers=new NativeHeaders(init.headers??old?.headers);this.signal=init.signal??old?.signal??new window.AbortController().signal;this.credentials=init.credentials??old?.credentials??'same-origin';this._body=init.body??old?._body??null;this.bodyUsed=false;if(['GET','HEAD'].includes(this.method)&&this._body!==null)throw new TypeError('GET/HEAD request cannot have body');}
    clone(){if(this.bodyUsed)throw new TypeError('Body already used');return new NativeRequest(this);}
    async arrayBuffer(){if(this.bodyUsed)throw new TypeError('Body already used');this.bodyUsed=true;return bodyBlob(this._body).arrayBuffer();}
    async text(){return decoder.decode(await this.arrayBuffer());}async json(){return JSON.parse(await this.text());}
  }
  const bodyBlob=body=>body instanceof NativeFormData?body.toBlob():body instanceof NativeBlob?body:new NativeBlob(body===null||body===undefined?[]:[body]);
  class NativeFileReader {
    constructor(){this.result=null;this.error=null;this.readyState=0;this._generation=0;this._listeners=new Map();}
    addEventListener(name,fn){const values=this._listeners.get(name)||new Set();values.add(fn);this._listeners.set(name,values);}
    removeEventListener(name,fn){this._listeners.get(name)?.delete(fn);}
    _emit(name){const event={type:name,target:this,currentTarget:this};this['on'+name]?.(event);for(const fn of this._listeners.get(name)||[])fn(event);}
    _read(blob,type){const generation=++this._generation;this.readyState=1;this._emit('loadstart');Promise.resolve().then(async()=>{const bytes=await blob.arrayBuffer();return type==='arrayBuffer'?bytes:type==='dataURL'?'data:'+(blob.type||'application/octet-stream')+';base64,'+wx.arrayBufferToBase64(bytes):decoder.decode(bytes);}).then(result=>{if(generation!==this._generation)return;this.result=result;this.readyState=2;this._emit('load');this._emit('loadend');},error=>{if(generation!==this._generation)return;this.error=error;this.readyState=2;this._emit('error');this._emit('loadend');});}
    readAsArrayBuffer(blob){this._read(blob,'arrayBuffer');}readAsDataURL(blob){this._read(blob,'dataURL');}readAsText(blob){this._read(blob,'text');}
    abort(){this._generation++;this.result=null;this.readyState=2;this._emit('abort');this._emit('loadend');}
  }
  class NativeWebSocket {
    constructor(url,protocols=[]) {
      const parsed=new window.URL(url), expected=config.origin.replace(/^https:/,'wss:');
      if(parsed.origin!==expected||parsed.pathname!=='/backend/realtime/v1/websocket')throw new TypeError('实时连接地址与当前环境不一致。');
      this.url=parsed.href;this.readyState=0;this.bufferedAmount=0;this.binaryType='arraybuffer';this.protocol='';this.extensions='';this._listeners=new Map();
      this._socket=wx.connectSocket({url:this.url,protocols:typeof protocols==='string'?[protocols]:protocols,fail:()=>{this.readyState=3;this._emit('error',{message:'实时连接失败'});}});
      this._socket.onOpen(event=>{this.readyState=1;this.protocol=event.header?.['Sec-WebSocket-Protocol']||'';this._emit('open',{});});
      this._socket.onMessage(event=>this._emit('message',{data:event.data}));
      this._socket.onError(()=>this._emit('error',{message:'实时连接失败'}));
      this._socket.onClose(event=>{this.readyState=3;this._emit('close',{code:event.code||1006,reason:event.reason||'',wasClean:event.code===1000});});
    }
    addEventListener(name,fn){const listeners=this._listeners.get(name)||new Set();listeners.add(fn);this._listeners.set(name,listeners);}
    removeEventListener(name,fn){this._listeners.get(name)?.delete(fn);}
    _emit(name,detail){const event={type:name,target:this,currentTarget:this,...detail};this['on'+name]?.(event);for(const fn of this._listeners.get(name)||[])fn(event);}
    send(data){if(this.readyState!==1)throw Object.assign(new Error('实时连接尚未打开'),{name:'InvalidStateError'});if(ArrayBuffer.isView(data))data=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);this._socket.send({data});}
    close(code=1000,reason=''){if(this.readyState>=2)return;this.readyState=2;this._socket.close({code,reason,fail:()=>{this.readyState=3;}});}
  }
  Object.assign(NativeWebSocket,{CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3});
  Object.assign(NativeWebSocket.prototype,{CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3});
  const objectUrls=new Map();let nextFile=0;
  const mimeExt=type=>({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','text/html':'html'}[type]||'bin');
  window.URL.createObjectURL=blob=>{if(!(blob instanceof NativeBlob))throw new TypeError('Expected Blob');const file=wx.env.USER_DATA_PATH+'/storehub-generated-'+Date.now()+'-'+(++nextFile)+'.'+mimeExt(blob.type);wx.getFileSystemManager().writeFileSync(file,blob._bytes.slice().buffer);objectUrls.set(file,blob);return file;};
  window.URL.revokeObjectURL=file=>{if(objectUrls.has(file)){objectUrls.delete(file);try{wx.getFileSystemManager().unlinkSync(file);}catch{/* The generated temporary file may already have been reclaimed. */}}};
  const aborted=()=>Object.assign(new Error('请求已取消'),{name:'AbortError'});
  const cloudFetch=async(input,init={})=>{
    if(typeof input==='string'&&objectUrls.has(input))return new NativeResponse(objectUrls.get(input));
    const request=new NativeRequest(input,init);
    if(request.signal.aborted)throw aborted();
    const url=new window.URL(request.url);
    if(url.origin!==config.origin)throw new TypeError('小程序请求地址与当前环境不一致。');
    const headers=new NativeHeaders(request.headers),body=request._body===null?null:bodyBlob(request._body);
    if(body?.size>3*1024*1024)throw new Error('文件超过小程序单次传输上限，请压缩后重试。');
    if(body?.type&&!headers.has('content-type'))headers.set('content-type',body.type);
    const data={path:url.pathname+url.search,method:request.method,headers:Object.fromEntries(headers)};
    if(body){if(typeof request._body==='string'){data.body=request._body;data.encoding='utf8';}else{data.body=wx.arrayBufferToBase64(await body.arrayBuffer());data.encoding='base64';}}
    if(request.signal.aborted)throw aborted();
    let abort;
    const abortPromise=new Promise((_,reject)=>{abort=()=>reject(aborted());request.signal.addEventListener('abort',abort,{once:true});});
    try{
      const call=wx.cloud.callHTTPFunction({name:config.functionName,path:'/proxy',method:'POST',header:{'content-type':'application/json'},data,config:{env:config.envId}});
      const response=await Promise.race([call,abortPromise]);
      const result=typeof response.data==='string'?JSON.parse(response.data):response.data;
      if(!result||!Number.isInteger(result.status)||!['utf8','base64'].includes(result.encoding)||typeof result.body!=='string')throw new TypeError('小程序服务返回格式不正确。');
      const content=result.encoding==='base64'?wx.base64ToArrayBuffer(result.body):result.body;
      return new NativeResponse(content,{status:result.status,headers:result.headers,url:request.url});
    }finally{request.signal.removeEventListener('abort',abort);}
  };
  Object.assign(window,{Blob:NativeBlob,File:NativeFile,FileList:class FileList{},Headers:NativeHeaders,Request:NativeRequest,Response:NativeResponse,FormData:NativeFormData,FileReader:NativeFileReader,WebSocket:NativeWebSocket,TextEncoder,TextDecoder,fetch:cloudFetch});
  wx.cloud.init({env:config.envId,traceUser:false});
  return {NativeBlob,NativeFile,NativeHeaders,NativeFormData,NativeResponse,NativeRequest,NativeFileReader,cloudFetch,objectUrls};
};
