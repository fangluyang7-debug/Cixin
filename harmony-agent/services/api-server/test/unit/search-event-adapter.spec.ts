import { StandardSearchEventAdapterService } from '../../src/modules/sessions/application/standard-search-event-adapter.service';

describe('StandardSearchEventAdapterService', () => {
  it('reports only actually verified candidates in verification progress', () => {
    const adapter = new StandardSearchEventAdapterService();
    const item = (id: string, verificationStatus: string) => ({
      id,
      title: id,
      platformName: 'jd',
      amount: '100',
      currency: 'CNY',
      stockStatus: 'in_stock',
      coverImageUrl: null,
      productUrl: null,
      matchSummaryJson: JSON.stringify({ verificationStatus }),
    });
    const events = adapter.toReplayEvents({
      sessionId: 'session_1',
      session: {
        status: 'ready',
        stage: 'candidate_ready',
        degraded: false,
        startedAt: new Date(),
        profileSnapshot: null,
        queryImagePreprocessSnapshots: [],
        candidateSnapshots: [
          {
            id: 'snapshot_1',
            degraded: false,
            items: [
              item('verified', 'verified'),
              item('fast-path', 'not_verified'),
            ],
          },
        ],
      } as never,
    });

    const progress = events.find((event) => event.type === 'verify_progress');
    expect(progress?.data).toEqual({
      verifiedCount: 1,
      totalSelectedForVerification: 1,
    });
  });
});
