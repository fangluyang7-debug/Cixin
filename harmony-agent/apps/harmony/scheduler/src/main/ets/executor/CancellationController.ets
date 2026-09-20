import { CancellationCallback, CancellationSignal, Unsubscribe } from '../api/SchedulerTypes';

class CancellationSignalImpl implements CancellationSignal {
  private cancelled: boolean = false;
  private callbacks: CancellationCallback[] = [];

  public get isCancellationRequested(): boolean {
    return this.cancelled;
  }

  public onCancelled(callback: CancellationCallback): Unsubscribe {
    if (this.cancelled) {
      callback();
      return (): void => {};
    }
    this.callbacks.push(callback);
    return (): void => {
      const index: number = this.callbacks.indexOf(callback);
      if (index >= 0) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  public cancel(): boolean {
    if (this.cancelled) {
      return false;
    }
    this.cancelled = true;
    const callbacks: CancellationCallback[] = this.callbacks.slice();
    this.callbacks = [];
    callbacks.forEach((callback: CancellationCallback) => {
      try {
        callback();
      } catch (error) {
        // Cancellation cleanup must not stop other callbacks.
      }
    });
    return true;
  }
}

export class CancellationController {
  private readonly signalImpl: CancellationSignalImpl = new CancellationSignalImpl();

  public get signal(): CancellationSignal {
    return this.signalImpl;
  }

  public cancel(): boolean {
    return this.signalImpl.cancel();
  }
}
