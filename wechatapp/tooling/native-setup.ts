import URLPolyfill from 'core-js-pure/actual/url/index.js';
import URLSearchParamsPolyfill from 'core-js-pure/actual/url-search-params/index.js';
import {AbortController,AbortSignal} from 'abort-controller/dist/abort-controller.mjs';
import {installNativeWeb} from './native-web.cjs';
import {installNativeScrolling} from './native-scrolling.cjs';
import {installNativeDialogs} from './native-dialogs.cjs';
import {installNativeFiles} from './native-files.cjs';
import {createUuid} from '../../src/lib/uuid';
import {installNativeCanvas} from './native-canvas.cjs';

export function install(window, document) {
  const encodeClass=name=>/^[a-zA-Z0-9_-]+$/.test(name)?name:`twx_${Array.from(name).map(char=>char.codePointAt(0).toString(16)).join('_')}`;
  const encodeClasses=value=>value.split(/\s+/).map(encodeClass).join(' ');
  const proto=Object.getPrototypeOf(document.createElement('div'));
  if(!proto.__storehubClassNamesInstalled){
    const setAttribute=proto.setAttribute;
    proto.setAttribute=function(name,value){return setAttribute.call(this,name,name==='class'&&typeof value==='string'?encodeClasses(value):value);};
    const descriptor=Object.getOwnPropertyDescriptor(proto,'className');
    if(descriptor?.set)Object.defineProperty(proto,'className',{...descriptor,set(value){descriptor.set.call(this,encodeClasses(value));}});
    Object.defineProperty(proto,'__storehubClassNamesInstalled',{value:true});
  }
  Object.assign(window,{URL:URLPolyfill,URLSearchParams:URLSearchParamsPolyfill,AbortController,AbortSignal});
  document.documentElement.style.fontSize='16px';
  installNativeWeb(window,wx,__STOREHUB_MINIPROGRAM__);
  installNativeScrolling(window,document,wx);
  installNativeDialogs(window,wx);
  installNativeFiles(window,document,wx);
  installNativeCanvas(window,document,wx);
  window.__storehubCreateUuid=createUuid;
  window.navigator.clipboard={writeText:text=>new Promise((resolve,reject)=>wx.setClipboardData({data:String(text),success:resolve,fail:reject}))};
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
}
