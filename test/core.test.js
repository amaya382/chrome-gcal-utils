const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeEventId, compilePatterns, groupDuplicates, layoutLanes, packRows, foldRanges, foldY } = require('../core.js');

const encode = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('decodeEventId splits event and calendar ids and expands suffixes', () => {
  assert.deepEqual(decodeEventId(encode('abc123 alice@m')), { eventId: 'abc123', calendarId: 'alice@gmail.com' });
  assert.deepEqual(decodeEventId(encode('abc123 team@g')), {
    eventId: 'abc123',
    calendarId: 'team@group.calendar.google.com',
  });
  assert.deepEqual(decodeEventId(encode('abc123 bob@example.com')), {
    eventId: 'abc123',
    calendarId: 'bob@example.com',
  });
});

test('decodeEventId ignores tasks, birthdays and garbage', () => {
  assert.equal(decodeEventId('tasks_xyz'), null);
  assert.equal(decodeEventId('bday_xyz'), null);
  assert.equal(decodeEventId('!!!'), null);
  assert.equal(decodeEventId(''), null);
});

test('compilePatterns is case-insensitive and reports invalid lines', () => {
  const { patterns, errors } = compilePatterns('^lunch$\n\n  focus time  \n(unclosed');
  assert.equal(patterns.length, 2);
  assert.ok(patterns[0].test('LUNCH'));
  assert.ok(patterns[1].test('Focus Time block'));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source, '(unclosed');
});

test('groupDuplicates merges by event id or by title and position within a scope', () => {
  const groups = groupDuplicates([
    { eventId: 'e1', title: 'Sync', scope: 'd0', pos: '100|50' },
    { eventId: 'e1', title: 'Sync', scope: 'd0', pos: '100|50' },
    { eventId: 'copy', title: ' sync ', scope: 'd0', pos: '100|50' },
    { eventId: 'e2', title: 'Sync', scope: 'd0', pos: '200|50' },
    { eventId: 'e1', title: 'Sync', scope: 'd1', pos: '100|50' },
  ]);
  const sorted = groups.map((g) => g.sort()).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(sorted, [[0, 1, 2], [3], [4]]);
});

test('groupDuplicates does not merge chips without a title by content', () => {
  const groups = groupDuplicates([
    { eventId: 'a', title: '', scope: 'd0', pos: '0|10' },
    { eventId: 'b', title: '', scope: 'd0', pos: '0|10' },
  ]);
  assert.equal(groups.length, 2);
});

test('layoutLanes gives full width to isolated events', () => {
  assert.deepEqual(layoutLanes([{ top: 0, bottom: 10 }, { top: 10, bottom: 20 }]), [
    { left: 0, width: 100 },
    { left: 0, width: 100 },
  ]);
});

test('layoutLanes splits three overlapping events into thirds', () => {
  const r = layoutLanes([
    { top: 0, bottom: 30 },
    { top: 0, bottom: 30 },
    { top: 0, bottom: 30 },
  ]);
  assert.deepEqual(
    r.map((x) => Math.round(x.left)),
    [0, 33, 67],
  );
  r.forEach((x) => assert.equal(Math.round(x.width), 33));
});

test('layoutLanes reuses lanes and widens events with free space to the right', () => {
  // A [0,60) overlaps B [0,30) and C [30,60); B and C share a lane.
  // D [40,50) overlaps A and C, forcing three lanes in the chained cluster.
  const r = layoutLanes([
    { top: 0, bottom: 60 },
    { top: 0, bottom: 30 },
    { top: 30, bottom: 60 },
    { top: 40, bottom: 50 },
  ]);
  const pct = r.map((x) => [Math.round(x.left), Math.round(x.width)]);
  assert.deepEqual(pct[0], [0, 33]);
  assert.deepEqual(pct[1], [33, 67]);
  assert.deepEqual(pct[2], [33, 33]);
  assert.deepEqual(pct[3], [67, 33]);
});

test('layoutLanes keeps no two overlapping events in the same horizontal range', () => {
  const items = [
    { top: 0, bottom: 45 },
    { top: 15, bottom: 30 },
    { top: 20, bottom: 90 },
    { top: 50, bottom: 60 },
    { top: 55, bottom: 70 },
  ];
  const r = layoutLanes(items);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const vertical = items[i].top < items[j].bottom && items[j].top < items[i].bottom;
      const horizontal = r[i].left < r[j].left + r[j].width - 1e-6 && r[j].left < r[i].left + r[i].width - 1e-6;
      assert.ok(!(vertical && horizontal), `events ${i} and ${j} overlap`);
    }
  }
});

test('packRows moves events up into rows freed by removed events', () => {
  // Rows were 0: [0,2) 1: [0,1) 2: [1,3); after removing row 0 the rest compacts.
  assert.deepEqual(
    packRows([
      { start: 0, end: 1, row: 1 },
      { start: 1, end: 3, row: 2 },
    ]),
    [0, 0],
  );
  assert.deepEqual(
    packRows([
      { start: 0, end: 2, row: 0 },
      { start: 1, end: 3, row: 3 },
      { start: 2, end: 4, row: 5 },
    ]),
    [0, 1, 0],
  );
});

test('foldRanges builds early and late ranges and drops empty ones', () => {
  assert.deepEqual(foldRanges(8, 20), [
    { name: 'early', start: 0, end: 8 },
    { name: 'late', start: 20, end: 24 },
  ]);
  assert.deepEqual(foldRanges(0, 24), []);
  assert.deepEqual(foldRanges(10, 6), [
    { name: 'early', start: 0, end: 10 },
    { name: 'late', start: 10, end: 24 },
  ]);
  assert.deepEqual(foldRanges('7', '30'), [{ name: 'early', start: 0, end: 7 }]);
});

test('foldY compresses folded ranges into bands and shifts what follows', () => {
  const ranges = [
    { top: 0, bottom: 400 },
    { top: 1000, bottom: 1200 },
  ];
  assert.equal(foldY(0, ranges, 20), 0);
  assert.equal(foldY(200, ranges, 20), 10);
  assert.equal(foldY(400, ranges, 20), 20);
  assert.equal(foldY(700, ranges, 20), 320);
  assert.equal(foldY(1100, ranges, 20), 630);
  assert.equal(foldY(1200, ranges, 20), 640);
});
