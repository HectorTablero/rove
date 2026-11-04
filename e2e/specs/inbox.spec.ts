import { weekendWindow } from '../../web/src/lib/when';
import { expect, test } from '../support/app';

/* Phase 2 from the user's side: a candidate the server polled shows up as a suggestion, keeping
 * it is an ordinary status write, "this weekend" finds it by its window, and a feed that has gone
 * quiet is said out loud rather than shown as an empty inbox. */

/* Inside the same window the app computes, whatever day the suite runs on: an hour before the
   weekend ends. Imported from the app rather than re-derived, so the two cannot disagree. */
const IN_THIS_WEEKEND = () =>
  new Date(weekendWindow(new Date(), 'Asia/Shanghai').end.getTime() - 3_600_000).toISOString();

const candidate = (id: string, title: string, start: string | null) => ({
  id,
  regionId: 'shenzhen',
  kind: 'event' as const,
  title,
  altTitles: [],
  categories: [],
  status: 'candidate' as const,
  snapshotIds: [],
  sourceUrls: [`https://detail.damai.cn/item.htm?id=${id.slice(-3)}`],
  expiresAt: '2099-01-01T00:00:00.000Z',
  price: null,
  coverUrl: null,
  location: null,
  when: start ? { start, end: null, tz: 'Asia/Shanghai', allDay: false } : null,
  venue: '深圳湾体育中心',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
});

test('a polled event is suggested, can be kept, and is found by "this weekend"', async ({
  app: page,
  api,
}) => {
  api.state.items = [
    candidate('507f1f77bcf86cd799439021', '张学友演唱会', IN_THIS_WEEKEND()),
    candidate('507f1f77bcf86cd799439022', '未定档的展', null),
  ];

  await page.goto('/list');
  const list = page.getByRole('list', { name: 'List' });
  await expect(list.getByText('张学友演唱会')).toBeVisible({ timeout: 20_000 });
  // The badge on the tab counts them.
  await expect(page.getByText('2 new suggestions').first()).toBeVisible();

  // "This weekend" keeps the dated one and drops the undated one.
  await page.getByRole('button', { name: 'This weekend' }).click();
  await expect(list.getByText('张学友演唱会')).toBeVisible();
  await expect(list.getByText('未定档的展')).toHaveCount(0);
  await page.getByRole('button', { name: 'This weekend' }).click();

  // The sheet shows venue and time, and Keep queues a status write.
  await list.getByText('未定档的展').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('深圳湾体育中心')).toBeVisible();
  await expect(sheet.getByText('Time unknown')).toBeVisible();
  await sheet.getByRole('button', { name: 'Keep' }).click();
  const patch = await api.waitForCall('PATCH', /^\/api\/items\/507f1f77bcf86cd799439022$/, 20_000);
  expect((patch.body as { status: string }).status).toBe('saved');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('1 new suggestion').first()).toBeVisible();
});

test('a feed that answered nothing twice is announced, by name', async ({ app: page, api }) => {
  api.sourceStatus = [
    {
      sourceId: 'damai',
      down: true,
      lastRun: {
        at: '2026-09-12T00:00:00.000Z',
        ok: true,
        found: 0,
        created: 0,
        error: null,
        trigger: 'schedule',
      },
    },
    { sourceId: 'maoyan', down: false, lastRun: null },
  ];

  await page.goto('/list');
  await expect(page.getByRole('alert')).toContainText('大麦', { timeout: 20_000 });
  await expect(page.getByRole('alert')).not.toContainText('猫眼');
});

test('the list narrows by a feed tag and shows the price the feed printed', async ({
  app: page,
  api,
}) => {
  api.state.items = [
    {
      ...candidate('507f1f77bcf86cd799439031', '回春丹 深圳站', null),
      categories: ['摇滚'],
      price: '¥180-280',
    },
    { ...candidate('507f1f77bcf86cd799439032', '城市爵士夜', null), categories: ['爵士'] },
  ];

  await page.goto('/list');
  const list = page.getByRole('list', { name: 'List' });
  await expect(list.getByText('城市爵士夜')).toBeVisible({ timeout: 20_000 });
  // Shown normalised: the feed's hyphen becomes an en dash, the symbol leads.
  await expect(list.getByText('¥180–280')).toBeVisible();

  await page.getByRole('group', { name: 'Tags' }).getByRole('button', { name: '摇滚' }).click();
  await expect(list.getByText('回春丹 深圳站')).toBeVisible();
  await expect(list.getByText('城市爵士夜')).toHaveCount(0);

  // Films filter on top of it: nothing left, and Clear brings everything back.
  await page.getByRole('button', { name: 'Films' }).click();
  await expect(page.getByText('No results')).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(list.getByText('城市爵士夜')).toBeVisible();
});
