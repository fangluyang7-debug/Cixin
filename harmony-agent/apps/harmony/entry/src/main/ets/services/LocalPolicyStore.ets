import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { PolicyStateStore } from 'scheduler';

export class LocalPolicyStore implements PolicyStateStore {
  private readonly context: common.Context;
  constructor(context: common.Context) { this.context = context; }

  public async load(): Promise<string | null> {
    try {
      const store = await preferences.getPreferences(this.context, { name: 'scheduler_policy_v1' });
      const raw = await store.get('state', '');
      if (typeof raw !== 'string') { throw new Error('Invalid policy storage type.'); }
      return raw.length > 0 ? raw : null;
    } catch (_) { throw new Error('Local policy state could not be read.'); }
  }

  public async save(snapshot: string): Promise<void> {
    try {
      const store = await preferences.getPreferences(this.context, { name: 'scheduler_policy_v1' });
      await store.put('state', snapshot);
      await store.flush();
    } catch (_) { throw new Error('Local policy state could not be saved.'); }
  }
}
