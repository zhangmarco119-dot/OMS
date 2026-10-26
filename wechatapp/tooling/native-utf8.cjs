// A cursor-based UTF-8 codec. The previous polyfill used Array.shift() per
// codepoint, making large JSON responses quadratic on Mini Program JS engines.
class TextEncoder {
  get encoding(){return 'utf-8';}
  encode(input=''){
    const text=String(input),bytes=new Uint8Array(text.length*3);
    const result=this.encodeInto(text,bytes);
    return bytes.slice(0,result.written);
  }
  encodeInto(input,destination){
    const text=String(input);let read=0,written=0;
    while(read<text.length){
      let point=text.charCodeAt(read),units=1;
      if(point>=0xd800&&point<=0xdbff){
        const low=text.charCodeAt(read+1);
        if(low>=0xdc00&&low<=0xdfff){point=0x10000+((point-0xd800)<<10)+(low-0xdc00);units=2;}
        else point=0xfffd;
      }else if(point>=0xdc00&&point<=0xdfff)point=0xfffd;
      const size=point<0x80?1:point<0x800?2:point<0x10000?3:4;
      if(written+size>destination.length)break;
      if(size===1)destination[written++]=point;
      else {
        if(size===2)destination[written++]=0xc0|(point>>6);
        else if(size===3){destination[written++]=0xe0|(point>>12);destination[written++]=0x80|((point>>6)&63);}
        else {destination[written++]=0xf0|(point>>18);destination[written++]=0x80|((point>>12)&63);destination[written++]=0x80|((point>>6)&63);}
        destination[written++]=0x80|(point&63);
      }
      read+=units;
    }
    return {read,written};
  }
}
class TextDecoder {
  constructor(label='utf-8',options={}){
    if(!['utf-8','utf8','unicode-1-1-utf-8'].includes(String(label).trim().toLowerCase()))throw new RangeError('Only UTF-8 is supported');
    this.encoding='utf-8';this.fatal=!!options.fatal;this.ignoreBOM=!!options.ignoreBOM;this._pending=new Uint8Array();this._streaming=false;this._bomSeen=false;
  }
  decode(input=new Uint8Array(),options={}){
    let bytes=ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):new Uint8Array(input);
    if(!this._streaming)this._bomSeen=false;
    if(this._pending.length){const merged=new Uint8Array(this._pending.length+bytes.length);merged.set(this._pending);merged.set(bytes,this._pending.length);bytes=merged;}
    this._pending=new Uint8Array();this._streaming=!!options.stream;
    const parts=[],chunk=[];
    const emit=point=>{
      if(!this._bomSeen){this._bomSeen=true;if(point===0xfeff&&!this.ignoreBOM)return;}
      if(point>0xffff){point-=0x10000;chunk.push(0xd800+(point>>10),0xdc00+(point&1023));}else chunk.push(point);
      if(chunk.length>=1024){parts.push(String.fromCharCode(...chunk));chunk.length=0;}
    };
    const invalid=()=>{if(this.fatal)throw new TypeError('The encoded data is not valid UTF-8');emit(0xfffd);};
    for(let i=0;i<bytes.length;){
      const first=bytes[i];
      if(first<0x80){emit(first);i++;continue;}
      const size=first>=0xc2&&first<=0xdf?2:first>=0xe0&&first<=0xef?3:first>=0xf0&&first<=0xf4?4:0;
      if(!size){invalid();i++;continue;}
      let point=first&[0,0,31,15,7][size],j=1;
      for(;j<size&&i+j<bytes.length;j++){
        const value=bytes[i+j];
        const lower=j===1&&first===0xe0?0xa0:j===1&&first===0xf0?0x90:0x80;
        const upper=j===1&&first===0xed?0x9f:j===1&&first===0xf4?0x8f:0xbf;
        if(value<lower||value>upper)break;
        point=(point<<6)|(value&63);
      }
      if(j===size){emit(point);i+=size;}
      else if(i+j===bytes.length&&options.stream){this._pending=bytes.slice(i);break;}
      else {invalid();i+=j;}
    }
    if(chunk.length)parts.push(String.fromCharCode(...chunk));
    return parts.join('');
  }
}
module.exports={TextEncoder,TextDecoder};
