exports.createNativeGlobals = () => ({
  ...Object.fromEntries(['fetch','Headers','Request','Response','URL','URLSearchParams','AbortController','AbortSignal','Blob','File','FileList','FileReader','FormData','WebSocket','TextEncoder','TextDecoder'].map(name => [name, `window.${name}`])),
  'globalThis.localStorage': 'window.localStorage',
  'globalThis.sessionStorage': 'window.sessionStorage',
  Intl: 'window.Intl',
  'crypto.randomUUID': 'window.__storehubCreateUuid',
});
