import { regionById, SOURCES } from '@rove/shared';
import { describe, expect, it } from 'vitest';
import { parseFeed } from '../rss';
import { damaiPoller, doubanEventsPoller, maoyanPoller, POLLERS, showstartPoller } from './index';

/* The four mappings against feeds shaped like RSSHub's. The fixtures are this project's reading
   of the routes' descriptions, not captures — the live shape is checked against a self-hosted
   RSSHub. What is pinned here is the tolerance: a labelled line is read when present, the whole
   text is scanned for a date when not, and nothing invents a time. */

const region = {
  ...regionById('shenzhen'),
  sourceParams: { ...regionById('shenzhen').sourceParams, showstart: { cityCode: '4' } },
};
const now = new Date('2026-09-12T00:00:00.000Z');

const feed = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;
const item = (title: string, link: string, description: string) =>
  `<item><title><![CDATA[${title}]]></title><link>${link}</link><description><![CDATA[${description}]]></description></item>`;

describe('registry', () => {
  it('has a poller for every manifest that polls, and nothing else', () => {
    expect(POLLERS.map((p) => p.id).sort()).toEqual(
      SOURCES.filter((s) => s.polls)
        .map((s) => s.id)
        .sort(),
    );
  });

  it('refuses to build a route when the region lacks a parameter', () => {
    const blank = {
      ...regionById('shenzhen'),
      sourceParams: { ...regionById('shenzhen').sourceParams, showstart: { cityCode: '' } },
    };
    expect(() => showstartPoller.route(blank)).toThrow(/poll.missing_param:showstart.cityCode/);
    expect(showstartPoller.route(region)).toBe('/showstart/event/4');
    expect(damaiPoller.route(region)).toBe('/damai/activity/%E6%B7%B1%E5%9C%B3/全部/全部');
    expect(doubanEventsPoller.route(region)).toBe('/douban/event/hot/118282');
  });
});

describe('damai', () => {
  it('reads venue and show time from labelled lines', () => {
    const [entry] = parseFeed(
      feed(
        item(
          '2026 张学友演唱会 深圳站',
          'https://detail.damai.cn/item.htm?id=123',
          '<img src="x.jpg"><p>演出城市：深圳</p><p>场馆：深圳湾体育中心</p><p>演出时间：2026.09.20-2026.09.21</p><p>票价：380-1680</p>',
        ),
      ),
    );
    const draft = damaiPoller.map(entry, region, now)!;
    expect(draft.kind).toBe('event');
    expect(draft.venue).toBe('深圳湾体育中心');
    expect(draft.when?.start).toBe('2026-09-19T16:00:00.000Z');
    expect(draft.when?.end).toBe('2026-09-21T15:59:00.000Z');
    expect(draft.expiresAt).toBe('2026-09-21T15:59:00.000Z');
    expect(draft.text).toContain('票价：380-1680');
  });
});

describe('showstart', () => {
  it('maps a show with a time, and one without a time as undated', () => {
    const [dated, undated] = parseFeed(
      feed(
        item(
          '回春丹 深圳站',
          'https://www.showstart.com/event/1',
          '<p>演出时间：2026-10-02 20:00</p><p>场地：HOU Live</p>',
        ) + item('周末市集', 'https://www.showstart.com/event/2', '<p>场地：蛇口</p>'),
      ),
    );
    expect(showstartPoller.map(dated, region, now)?.when?.start).toBe('2026-10-02T12:00:00.000Z');
    const second = showstartPoller.map(undated, region, now)!;
    expect(second.when).toBeNull();
    expect(second.venue).toBe('蛇口');
    expect(second.expiresAt).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('douban', () => {
  it('finds a date anywhere in the text when there is no labelled line', () => {
    const [entry] = parseFeed(
      feed(
        item(
          '海边露天电影',
          'https://www.douban.com/event/9',
          '<p>9月27日晚（2026-09-27 19:30）在大梅沙</p><p>免费</p>',
        ),
      ),
    );
    const draft = doubanEventsPoller.map(entry, region, now)!;
    expect(draft.when?.start).toBe('2026-09-27T11:30:00.000Z');
    expect(draft.venue).toBeNull();
  });
});

describe('maoyan', () => {
  it('strips the score from the title, keeps it in the text, and expires after release + 60 days', () => {
    const [entry] = parseFeed(
      feed(
        item(
          '[8.5分] 沙丘3',
          'https://www.maoyan.com/films/1',
          '<p>评分：8.5</p><p>上映时间：2026-09-05</p><p>主演：某人</p>',
        ),
      ),
    );
    const draft = maoyanPoller.map(entry, region, now)!;
    expect(draft.kind).toBe('film');
    expect(draft.title).toBe('沙丘3');
    expect(draft.text).toContain('评分：8.5');
    expect(draft.when?.allDay).toBe(true);
    // Released a week ago: sixty days from *now*, not from a release date already behind us.
    expect(draft.expiresAt).toBe('2026-11-11T00:00:00.000Z');
  });
});
