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
  sources: ['instagram-oembed', 'xiaohongshu-share', 'generic-og'],
};
