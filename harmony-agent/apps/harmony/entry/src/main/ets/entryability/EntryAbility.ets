import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DataInitService } from '../services/DataInitService';
import { ShoppingTaskService } from '../services/ShoppingTaskService';
import { LocalPolicyStore } from '../services/LocalPolicyStore';
import { window } from '@kit.ArkUI';
import {
  AppVisibility,
  Backend,
  HarmonyDeviceStateAdapter,
  InferenceLocation,
  ModelTier,
  PolicyMode,
  RealDeviceStatePatch,
  SchedulerConfig,
  SchedulerService
} from 'scheduler';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  private readonly schedulerService: SchedulerService = SchedulerService.getInstance();
  private deviceStateAdapter: HarmonyDeviceStateAdapter | null = null;
  private schedulerStartup: Promise<void> | null = null;
  private destroyed: boolean = false;
  private appVisibility: AppVisibility = AppVisibility.FOREGROUND;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.destroyed = false;
    this.appVisibility = AppVisibility.FOREGROUND;
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to set colorMode. Cause: %{public}s', JSON.stringify(err));
    }
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate');

    // Initialize local database and load sample JSON data if empty
    DataInitService.checkAndInitData(this.context);

    const schedulerConfig: SchedulerConfig = {
      policyStateStore: new LocalPolicyStore(this.context),
      defaultPolicyMode: PolicyMode.ADAPTIVE,
      enableDebugInjection: true,
      metricsWindowSize: 100,
      upgradeStableDurationMs: 10000,
      minimumTierHoldMs: 5000,
      executors: [
        {
          capability: 'text_product_embedding_search',
          inferenceLocation: InferenceLocation.LOCAL_DEVICE,
          backend: Backend.CPU,
          supportedModelTiers: [
            ModelTier.HIGH_ACCURACY,
            ModelTier.BALANCED,
            ModelTier.LIGHTWEIGHT
          ],
          supportedThreadCounts: [1, 2, 4]
        },
        {
          capability: 'image_product_embedding_search',
          inferenceLocation: InferenceLocation.LOCAL_DEVICE,
          backend: Backend.CPU,
          supportedModelTiers: [
            ModelTier.HIGH_ACCURACY,
            ModelTier.BALANCED,
            ModelTier.LIGHTWEIGHT
          ],
          supportedThreadCounts: [1, 2, 4]
        }
      ]
    };
    this.schedulerStartup = this.startScheduler(schedulerConfig);
    this.schedulerStartup.then(() => {
      if (!this.destroyed) {
        hilog.info(DOMAIN, 'Scheduler', '%{public}s', 'Scheduler HAR and device state adapter initialized.');
      }
    }).catch((error: Error) => {
      hilog.error(DOMAIN, 'Scheduler', 'Scheduler initialization failed: %{public}s', error.message);
    });
  }

  onDestroy(): void {
    this.destroyed = true;
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
    this.stopScheduler().catch((error: Error) => {
      hilog.error(DOMAIN, 'Scheduler', 'Scheduler shutdown failed: %{public}s', error.message);
    });
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
    });
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
    this.appVisibility = AppVisibility.FOREGROUND;
    if (this.schedulerService.isInitialized()) {
      this.schedulerService.updateRealDeviceState({ appVisibility: this.appVisibility });
    }
    if (this.deviceStateAdapter !== null) {
      this.deviceStateAdapter.refresh();
    }
  }

  onBackground(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
    this.appVisibility = AppVisibility.BACKGROUND;
    if (this.schedulerService.isInitialized()) {
      this.schedulerService.updateRealDeviceState({ appVisibility: this.appVisibility });
      this.schedulerService.flushPolicyState();
    }
  }

  private async startScheduler(config: SchedulerConfig): Promise<void> {
    await this.schedulerService.initialize(config);
    if (this.destroyed) {
      await this.schedulerService.shutdown();
      return;
    }
    ShoppingTaskService.getInstance().initialize(this.schedulerService);
    this.deviceStateAdapter = new HarmonyDeviceStateAdapter((patch: RealDeviceStatePatch): void => {
      if (this.schedulerService.isInitialized()) {
        this.schedulerService.updateRealDeviceState(patch);
      }
    });
    await this.deviceStateAdapter.start();

    if (this.destroyed) {
      await this.deviceStateAdapter.stop();
      this.deviceStateAdapter = null;
      await ShoppingTaskService.getInstance().dispose();
      await this.schedulerService.shutdown();
      return;
    }
    this.schedulerService.updateRealDeviceState({ appVisibility: this.appVisibility });
  }

  private async stopScheduler(): Promise<void> {
    if (this.schedulerStartup !== null) {
      try {
        await this.schedulerStartup;
      } catch (error) {
        // Initialization failure has already been logged by onCreate.
      }
      this.schedulerStartup = null;
    }
    if (this.deviceStateAdapter !== null) {
      await this.deviceStateAdapter.stop();
      this.deviceStateAdapter = null;
    }
    if (this.schedulerService.isInitialized()) {
      await ShoppingTaskService.getInstance().dispose();
      await this.schedulerService.shutdown();
    }
  }
}
