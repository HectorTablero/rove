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
    /* Showstart's city code is not published; RSSHub finds it: `/showstart/search/city/深圳` on
       the self-hosted instance prints the code. Empty means "not configured" and the poller says
       so instead of polling the wrong city. */
    showstart: { cityCode: '' },
    damai: { city: '深圳' },
    maoyan: {},
  },
};
