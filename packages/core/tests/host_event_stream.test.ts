import { describe, expect, it } from 'vitest';
import { HostEventStream } from '../src/host_event_stream.js';
describe('HostEventStream', () => {
  it('uses a stable session id and monotonic event sequence', () => {
    const events: any[]=[]; const stream=new HostEventStream((event)=>events.push(event),'session-1');
    stream.emit({type:'progress',step:1,maxSteps:2,status:'Working',timestamp:1});
    stream.emit({type:'completion',status:'completed',totalSteps:1,timestamp:2});
    expect(events.map(event=>event.sequence)).toEqual([1,2]);
    expect(events.every(event=>event.sessionId==='session-1'&&event.protocolVersion===1)).toBe(true);
  });
});