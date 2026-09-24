import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { fromJson } from "../../../common/utils/json";
import { PrismaService } from "../../../persistence/prisma/prisma.service";
import {
  SUGGESTION_VIEW_ADAPTER,
  SuggestionViewAdapter,
} from "./suggestion-view-adapter.interface";

@Injectable()
export class SuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SUGGESTION_VIEW_ADAPTER)
    private readonly suggestionViewAdapter: SuggestionViewAdapter,
  ) {}

  async getSuggestions(sessionId: string) {
    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");

    const snapshot = await this.prisma.candidateSnapshot.findFirst({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      include: { items: { orderBy: { amount: "asc" } } },
    });

    return this.suggestionViewAdapter.buildSuggestionsView({
      items: snapshot?.items ?? [],
      degraded: snapshot?.degraded ?? false,
      activeFilter: fromJson<Record<string, unknown>>(
        snapshot?.appliedFilterJson,
        {},
      ),
    });
  }
}
