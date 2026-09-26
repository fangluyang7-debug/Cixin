import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Sse,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { ok } from "../../../common/dto/api-response.dto";
import { AuthService } from "../../auth/application/auth.service";
import {
  SearchEventsService,
  SessionSearchEvent,
} from "../application/search-events.service";
import { ShoppingRuntimeService } from "../application/shopping-runtime.service";
import { CreateSessionDto } from "../dto/create-session.dto";
import { CreateTextSessionDto } from "../dto/create-text-session.dto";
import { UpdateSubjectSelectionDto } from "../dto/subject-selection.dto";
import { UpdateProductProfileDto } from "../dto/update-product-profile.dto";

@Controller("api/v1/sessions")
export class SessionsController {
  constructor(
    private readonly runtime: ShoppingRuntimeService,
    private readonly searchEvents: SearchEventsService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async createSession(
    @Body() dto: CreateSessionDto,
    @Headers("authorization") authorization?: string,
  ) {
    const user = await this.auth.getUserFromAuthorization(authorization);
    return ok(
      await this.runtime.execute('shopping.image', { dto, userId: user?.userId ?? null }),
    );
  }

  @Post("text")
  async createTextSession(
    @Body() dto: CreateTextSessionDto,
    @Headers("authorization") authorization?: string,
  ) {
    const user = await this.auth.getUserFromAuthorization(authorization);
    return ok(
      await this.runtime.execute('shopping.text', { dto, userId: user?.userId ?? null }),
    );
  }

  @Get(":sessionId")
  async getSession(@Param("sessionId") sessionId: string) {
    return ok(await this.runtime.execute('shopping.read', { sessionId }));
  }

  @Post(":sessionId/subject-selection")
  async updateSubjectSelection(
    @Param("sessionId") sessionId: string,
    @Body() dto: UpdateSubjectSelectionDto,
  ) {
    return ok(
      await this.runtime.execute('shopping.subject', { sessionId, dto }),
    );
  }

  @Patch(":sessionId/profile")
  async updateProductProfile(
    @Param("sessionId") sessionId: string,
    @Body() dto: UpdateProductProfileDto,
  ) {
    return ok(await this.runtime.execute('shopping.profile', { sessionId, dto }));
  }

  @Post(":sessionId/candidates/refine")
  async refineCandidates(@Param("sessionId") sessionId: string) {
    return ok(await this.runtime.execute('shopping.refine', { sessionId }));
  }

  @Sse(":sessionId/search-events")
  searchEventStream(
    @Param("sessionId") sessionId: string,
  ): Observable<{ type: string; data: SessionSearchEvent }> {
    return new Observable((subscriber) => {
      this.searchEvents
        .buildReplayEvents(sessionId)
        .then((events) => {
          for (const event of events) {
            subscriber.next({ type: event.type, data: event });
          }
          subscriber.complete();
        })
        .catch((error) => subscriber.error(error));
    });
  }
}
