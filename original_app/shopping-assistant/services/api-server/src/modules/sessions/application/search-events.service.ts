import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import {
  SEARCH_EVENT_ADAPTER,
  SearchEventAdapter,
  SessionSearchEvent,
} from './search-event-adapter.interface';

export { SessionSearchEvent } from './search-event-adapter.interface';

@Injectable()
export class SearchEventsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SEARCH_EVENT_ADAPTER)
    private readonly eventAdapter: SearchEventAdapter,
  ) {}

  async buildReplayEvents(sessionId: string): Promise<SessionSearchEvent[]> {
    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
      include: {
        profileSnapshot: true,
        queryImagePreprocessSnapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        candidateSnapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { items: true },
        },
      },
    });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');

    return this.eventAdapter.toReplayEvents({ sessionId, session });
  }
}
