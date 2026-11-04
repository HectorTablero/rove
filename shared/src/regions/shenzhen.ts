import type { RegionDescriptor } from '../region';

/* Shenzhen, and by extension the Greater Bay Area: Amap for everything, GCJ-02 throughout, and
   the sources that actually reach here. The only region that exists. */
export const shenzhen: RegionDescriptor = {
  id: 'shenzhen',
  name: '深圳',
  tz: 'Asia/Shanghai',
  locale: 'zh-CN',
  currency: 'CNY',
  datum: 'GCJ02',
  // 市民中心, in Amap's own datum — the map opens here until the first location fix.
  center: { lon: 114.0579, lat: 22.5431, datum: 'GCJ02' },
  navigation: 'amap',
  geocoder: 'amap',
  renderer: 'amap',
  sources: [
    'instagram-oembed',
    'xiaohongshu-share',
    'douban-events',
    'showstart',
    'damai',
    'maoyan',
    'generic-og',
  ],
  sourceParams: {
    /* Douban's numeric city id, read from `window.__loc_id__` on douban.com/location/shenzhen.
       VERIFY against a self-hosted RSSHub: `/douban/event/hot/118282` should list Shenzhen events. */
    'douban-events': { locationId: '118282' },
    /* Showstart's city codes are telephone area codes (RSSHub's own example: Hangzhou 571), so
       Shenzhen is 0755 → 755. RSSHub's `/showstart/search/city/深圳` lookup crashes as of
       2026-11 (`localeCompare is not a function`); the feed title naming 深圳 is the check. */
    showstart: { cityCode: '755' },
    damai: { city: '深圳' },
    maoyan: {},
  },
};
