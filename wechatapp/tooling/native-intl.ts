import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/zh.js';
import '@formatjs/intl-numberformat/polyfill.js';
import '@formatjs/intl-numberformat/locale-data/en.js';
import '@formatjs/intl-numberformat/locale-data/zh.js';
import '@formatjs/intl-datetimeformat/polyfill.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';
import '@formatjs/intl-datetimeformat/locale-data/en-CA.js';
import '@formatjs/intl-datetimeformat/locale-data/zh.js';
import '@formatjs/intl-datetimeformat/locale-data/sv.js';
import './native-intl-timezones.generated.js';
import {installIntlCache} from './native-intl-cache.cjs';

export function install(window) {
  window.Intl = globalThis.Intl;
  // StoreHub operates on China dates, including Date#toLocaleString callers
  // which do not pass a timezone explicitly.
  if (window.Intl.DateTimeFormat.__setDefaultTimeZone) window.Intl.DateTimeFormat.__setDefaultTimeZone('Asia/Shanghai');
  installIntlCache(window.Intl);
}
