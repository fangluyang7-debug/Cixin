import { randomUUID } from 'node:crypto';

// Admission is synchronous on the target's control event loop; CPU work runs elsewhere.
export class LeaseManager {
  constructor({ slots = 1, memoryBytes = 256 * 1024 * 1024, clock = () => performance.now() } = {}) {
    this.slots = slots; this.memoryBytes = memoryBytes; this.clock = clock;
    this.leases = new Map(); this.fence = 0;
  }
  acquire({ ownerId, attemptId, memoryBytes, remainingBudgetMs }) {
    this.sweep();
    if (!/^[\w.-]{1,128}$/.test(ownerId) || !/^[\w.-]{1,128}$/.test(attemptId) ||
      !Number.isSafeInteger(memoryBytes) || memoryBytes <= 0 || !Number.isFinite(remainingBudgetMs) || remainingBudgetMs <= 0) throw new Error('LEASE_INVALID');
    const old = [...this.leases.values()].find(l => l.ownerId === ownerId && l.attemptId === attemptId);
    if (old) {
      if (old.memoryBytes !== memoryBytes) throw new Error('ATTEMPT_CONFLICT');
      return this.receipt(old);
    }
    if (this.leases.size >= 10000) throw new Error('RECEIPT_CAPACITY_FULL');
    const active = [...this.leases.values()].filter(l => !l.settled);
    if (active.length >= this.slots || active.reduce((n,l)=>n+l.memoryBytes,0)+memoryBytes > this.memoryBytes) throw new Error('CAPACITY_FULL');
    const lease = { leaseId:randomUUID(), ownerId, attemptId, memoryBytes, fencingToken:++this.fence,
      expiresMono:this.clock()+Math.min(remainingBudgetMs,300000), state:'ACCEPTED', settled:false, stopRequested:false, controller:new AbortController() };
    this.leases.set(lease.leaseId,lease); return this.receipt(lease);
  }
  require(ownerId,id) {
    this.sweep(); const lease=this.leases.get(id);
    if (!lease || lease.ownerId!==ownerId) throw new Error('LEASE_NOT_FOUND'); return lease;
  }
  execute(ownerId,id,fence,identity,work) {
    const lease=this.require(ownerId,id);
    if (lease.identity !== undefined) {
      if (lease.identity!==identity) throw new Error('ATTEMPT_CONFLICT');
      return this.receipt(lease);
    }
    if (lease.fencingToken!==fence || lease.stopRequested || lease.settled) throw new Error('LEASE_REVOKED');
    lease.identity=identity; lease.state='RUNNING'; lease.startedMono=this.clock();
    Promise.resolve().then(()=>work(lease.controller.signal)).then(output=> {
      this.sweep(); if (!lease.stopRequested && lease.fencingToken===fence) lease.output=output;
    }, error=>{ lease.errorCode=/^[A-Z0-9_]{1,100}$/.test(error?.message)?error.message:'EXECUTION_FAILED'; })
      .finally(()=>{ lease.settled=true; lease.state='SETTLED'; lease.executionMs=this.clock()-lease.startedMono; });
    return this.receipt(lease);
  }
  cancel(ownerId,id) { const lease=this.require(ownerId,id); this.revoke(lease); return this.receipt(lease); }
  revoke(lease) {
    if (lease.settled || lease.stopRequested) return;
    lease.stopRequested=true; lease.fencingToken=++this.fence; lease.controller.abort(new Error('STOP_REQUESTED'));
    if (lease.state==='ACCEPTED') { lease.settled=true; lease.state='SETTLED'; }
    else lease.state='STOP_REQUESTED';
  }
  sweep() { for (const lease of this.leases.values()) if (this.clock()>=lease.expiresMono) this.revoke(lease); }
  release(ownerId,id) { const lease=this.require(ownerId,id); if(!lease.settled) throw new Error('STOP_UNCONFIRMED'); lease.state='RELEASED'; }
  receipt(l) { return { leaseId:l.leaseId, attemptId:l.attemptId, fencingToken:l.fencingToken,state:l.state,
    stopRequested:l.stopRequested,settled:l.settled,remainingBudgetMs:Math.max(0,l.expiresMono-this.clock()),
    executionMs:l.executionMs??null,output:l.output??null,errorCode:l.errorCode??null }; }
}
