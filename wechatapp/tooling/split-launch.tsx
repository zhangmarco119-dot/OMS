import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {AuthProvider} from '../../src/features/auth/AuthContext';
import {LoginPage} from '../../src/pages/LoginPage';
import './styles.generated.css';
import './native-overrides.css';
export default async function createApp(){
  await window.__storehubIntlReady;
  const history=window.history;
  for(const method of ['pushState','replaceState']){
    const original=history[method].bind(history);
    history[method]=(state,title,url)=>{
      const next=new window.URL(url||window.location.href,window.location.origin);
      if(next.origin!==window.location.origin)throw new Error('小程序页面地址不受支持。');
      if(next.pathname==='/app'||next.pathname.startsWith('/app/')){window.location.replace(next.href);return;}
      return original(state,title,next.href);
    };
  }
  const container=document.createElement('div');container.id='root';document.body.appendChild(container);
  const root=createRoot(container);root.render(<AuthProvider><BrowserRouter><LoginPage/></BrowserRouter></AuthProvider>);return root;
}
