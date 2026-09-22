import { describe, expect, it } from 'vitest';
import { describeInterval, directBuses, directScheduled, nextBus, type Nearby, type Route } from './transit';

const route = (id: number, ref: string, stopIds: number[]): Route => ({ id, ref, name: '', from: null, to: null, interval: null, hours: null, operator: null, stopIds });
const stop = (id: number, distance: number) => ({ id, name: `Stop ${id}`, lat: 0, lng: 0, distance });

describe('directBuses', () => {
  const a = route(1, '10H', [100, 101, 200, 201]);
  const b = route(2, '5K', [200, 101]); // runs the other way
  const c = route(3, '47L', [300, 301]); // does not reach the destination
  const from: Nearby = { stops: [stop(101, 150), stop(100, 400)], routes: [a, b, c] };
  const to: Nearby = { stops: [stop(200, 90), stop(201, 300)], routes: [a, b] };

  it('finds routes that serve both places in the right direction', () => {
    const r = directBuses(from, to);
    expect(r.map((x) => x.route.ref)).toEqual(['10H']);
    expect(r[0].board.id).toBe(101); // nearest boarding stop on that route
    expect(r[0].alight.id).toBe(200); // nearest alighting stop
  });
  it('returns nothing when no route connects', () => {
    expect(directBuses({ stops: [stop(300, 50)], routes: [c] }, to)).toEqual([]);
  });
});

describe('nextBus (scheduled)', () => {
  const r = { first_bus: '06:00', last_bus: '22:00', frequency_min: 15, minutes_from_start: 10 };
  // 18:02 IST = 12:32 UTC
  const at = (utc: string) => new Date(`2026-09-22T${utc}:00Z`);
  it('gives the next departure at this stop', () => {
    expect(nextBus(r, at('12:32'))).toEqual({ label: 'Next around 6:10 pm', inMinutes: 8, running: true });
  });
  it('says when the first bus is before service starts', () => {
    expect(nextBus(r, at('00:00')).label).toBe('First bus at 6:10 am'); // 05:30 IST
  });
  it('says when service is over', () => {
    expect(nextBus(r, at('17:00')).running).toBe(false); // 22:30 IST
  });
});

describe('directScheduled', () => {
  const row = (route: string, seq: number, d: number) => ({ route_id: route, number: route, from_name: '', to_name: '', first_bus: '06:00', last_bus: '22:00', frequency_min: 10, service: null, seq, stop_name: `S${seq}`, lat: 0, lng: 0, minutes_from_start: null, distance_m: d });
  it('only matches routes going the right way', () => {
    const res = directScheduled([row('A', 2, 100), row('B', 5, 50)], [row('A', 6, 80), row('B', 1, 40)]);
    expect(res.map((x) => x.board.route_id)).toEqual(['A']);
  });
});

describe('describeInterval', () => {
  it('reads OSM interval formats', () => {
    expect(describeInterval('00:15')).toBe('About every 15 minutes');
    expect(describeInterval('20')).toBe('About every 20 minutes');
    expect(describeInterval('01:30')).toBe('About every 1.5 hours');
    expect(describeInterval(null)).toBeNull();
  });
});
