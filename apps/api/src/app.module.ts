import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ConfigModule } from "./config/config.module.js";
import { LoggerModule } from "./common/logging/logger.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { ProductsModule } from "./modules/products/products.module.js";
import { BasketModule } from "./modules/basket/basket.module.js";
import { BudgetModule } from "./modules/budget/budget.module.js";
import { FeedModule } from "./modules/feed/feed.module.js";
import { FleetModule } from "./modules/fleet/fleet.module.js";
import { HealModule } from "./modules/heal/heal.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IncidentsModule } from "./modules/incidents/incidents.module.js";
import { IngestModule } from "./modules/ingest/ingest.module.js";
import { NotifierModule } from "./modules/notifier/notifier.module.js";
import { PullersModule } from "./modules/pullers/pullers.module.js";
import { ValidatorModule } from "./modules/validator/validator.module.js";

@Module({
  imports: [
    // Infrastructure. ConfigModule first: everything else reads validated env.
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    JobsModule,

    // The dashboard is public and has no login, so the API is on the open
    // internet with it. 300/minute is deliberately loose: every server render
    // of the front page is three API calls and the healing page is four, and
    // they all arrive from ONE address -- the web container's, since it calls
    // the API directly over the compose network with no forwarded headers. A
    // tight global limit would throttle the site rather than an abuser.
    //
    // The endpoints that actually cost money carry their own much tighter
    // limit; see PullersController and HealController.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),

    // Dashboard reads.
    HealthModule,
    FleetModule,
    BasketModule,
    ProductsModule,
    FeedModule,
    IncidentsModule,
    BudgetModule,

    // Writes and inbound.
    IngestModule,

    // The engine.
    ValidatorModule,
    PullersModule,
    HealModule,
    NotifierModule,
  ],
  // The app's first global guard. Rate limiting is not a per-controller
  // decision -- a route that forgets it is exactly the route that needs it.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
