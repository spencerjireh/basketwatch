import { Module } from "@nestjs/common";
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
})
export class AppModule {}
