/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DatabaseManager, getRootLogger } from '@backstage/backend-common';
import {
  configServiceRef,
  createServiceFactory,
  createServiceRef,
  databaseServiceRef,
  loggerServiceRef,
  loggerToWinstonLogger,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { Lifecycle } from '@backstage/core-components';
import { once } from 'lodash';
import { Duration } from 'luxon';
import { Logger } from 'winston';
import { migrateBackendTasks } from '../database/migrateBackendTasks';
import { PluginTaskSchedulerImpl } from './PluginTaskSchedulerImpl';
import { PluginTaskSchedulerJanitor } from './PluginTaskSchedulerJanitor';
import { PluginTaskScheduler } from './types';

/**
 * Deals with the scheduling of distributed tasks.
 *
 * @public
 */
export class TaskScheduler {
  static fromConfig(
    config: Config,
    options?: {
      databaseManager?: DatabaseManager;
      logger?: Logger;
    },
  ): TaskScheduler {
    const databaseManager =
      options?.databaseManager ?? DatabaseManager.fromConfig(config);
    const logger = (options?.logger || getRootLogger()).child({
      type: 'taskManager',
    });
    return new TaskScheduler(databaseManager, logger);
  }

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Instantiates a task manager instance for the given plugin.
   *
   * @param pluginId - The unique ID of the plugin, for example "catalog"
   * @returns A {@link PluginTaskScheduler} instance
   */
  forPlugin(pluginId: string): PluginTaskScheduler {
    const databaseFactory = once(async () => {
      const databaseManager = this.databaseManager.forPlugin(pluginId);
      const knex = await databaseManager.getClient();

      if (!databaseManager.migrations?.skip) {
        await migrateBackendTasks(knex);
      }

      const janitor = new PluginTaskSchedulerJanitor({
        knex,
        waitBetweenRuns: Duration.fromObject({ minutes: 1 }),
        logger: this.logger,
      });
      janitor.start();

      return knex;
    });

    return new PluginTaskSchedulerImpl(
      databaseFactory,
      this.logger.child({ plugin: pluginId }),
    );
  }
}

const taskSchedulerServiceRef = createServiceRef({
  id: 'tasks.scheduler',
  scope: 'plugin',
});

export const taskScheduler = createServiceFactory({
  service: taskSchedulerServiceRef,
  deps: {
    databaseFactory: databaseServiceRef,
    loggerFactory: loggerServiceRef,
    configFactory: configServiceRef,
  },
  async factory(rootDeps) {
    await rootDeps.database(); // throw error
    const config = await configFactory();

    let started = false;

    return async (pluginId?: string, pluginDeps) => {
      await pluginDeps.database();
      const database = await pluginDeps.database(ROOT_PLUGIN_ID);

      const database = await databaseFactory(pluginId);
      const database = pluginDeps.database;
      const logger = loggerToWinstonLogger(await logger());

      const knex = await (await database()).getClient();

      if (!database.migrations?.skip) {
        await migrateBackendTasks(knex);
      }

      const janitor = new PluginTaskSchedulerJanitor({
        knex,
        waitBetweenRuns: Duration.fromObject({ minutes: 1 }),
        logger,
      });
      if (!started) {
        janitor.start();
        started = true;
      }

      return new PluginTaskSchedulerImpl(async () => knex, logger);
    };
  },
});

export const taskScheduler2 = createServiceFactory({
  service: taskSchedulerServiceRef,
  deps: {
    database: databaseServiceRef,
    logger: loggerServiceRef,
  },
  async factory({ database, logger }) {
    const winstonLogger = loggerToWinstonLogger(logger);

    const knex = await database.getClient();

    if (!database.migrations?.skip) {
      await migrateBackendTasks(knex);
    }

    const janitor = new PluginTaskSchedulerJanitor({
      knex,
      waitBetweenRuns: Duration.fromObject({ minutes: 1 }),
      logger: winstonLogger,
    });
    janitor.start();

    return new PluginTaskSchedulerImpl(async () => knex, winstonLogger);
  },
});

createBackend({
  logger: rootLogger,
});

export const loggerServiceFactory = createServiceFactory({
  service: loggerServiceRef,
  deps: {
    rootLogger: rootLoggerServiceRef,
    pluginMeta: pluginMetaServiceRef,
  },
  async factory({ pluginMeta, rootLogger }) {
    return rootLogger.child({ plugin: pluginMeta.pluginId });
  },
});

export const httpRouterFactory = createServiceFactory({
  service: httpRouterServiceRef,
  deps: {
    configFactory: configServiceRef,
  },
  async factory({ configFactory }) {
    const rootRouter = Router();

    const service = createServiceBuilder(module)
      .loadConfig(await configFactory('root'))
      .addRouter('', rootRouter);

    await service.start();

    return async (pluginId?: string) => {
      const path = pluginId ? `/api/${pluginId}` : '';
      return {
        use(handler: Handler) {
          rootRouter.use(path, handler);
        },
      };
    };
  },
});

const httpRootRouterServiceRef = createServiceRef({ scope: 'root' });

export const httpRootRouterFactory = createServiceFactory({
  service: httpRootRouterServiceRef,
  deps: {
    config: configServiceRef,
  },
  async factory({ config }) {
    const rootRouter = Router();

    const service = createServiceBuilder(module)
      .loadConfig(await configFactory('root'))
      .addRouter('', rootRouter);

    return service;
  },
});

export const githubCredentialsProvider = createServiceFactory({
  service: githubCredentialsProviderServiceRef,
  deps: {
    config: configServiceRef,
  },
  async context() {
    return {
      instances: [provider],
    };
  },
  async factory({ config }, ctx) {
    // haz internal state
    if (ctx.instance) {
      return ctx.instance;
    }
    const rootProvider = GithubCredentialsProvider.fromConfig(config);
    ctx.instance = rootProvider;

    return rootProvider;
  },
});

export const taskScheduler3 = createServiceFactory({
  service: taskSchedulerServiceRef,
  deps: {
    database: databaseServiceRef,
    logger: loggerServiceRef,
    myCustomSingleton: myCustomSingletonServiceRef,
    meta: pluginMetadataServiceRef,
  },
  async factory({ config, rootLogger }) {
    return async ({ database, logger, myCustomSingleton }) => {
      const winstonLogger = loggerToWinstonLogger(logger);

      const knex = await database.getClient();

      if (!database.migrations?.skip) {
        await migrateBackendTasks(knex);
      }

      const janitor = new PluginTaskSchedulerJanitor({
        knex,
        waitBetweenRuns: Duration.fromObject({ minutes: 1 }),
        logger: winstonLogger,
      });
      janitor.start();

      return new PluginTaskSchedulerImpl(async () => knex, winstonLogger);
    };
  },
});

createBackend({
  rootServices: {
    logger: rootLogger,
  },
});

/*

Current model: factory(depFactories) => (pluginId: string) => impl
Pros:
  - Easy to keep some global internal state in factory
  - Very lazy, plugin deps are only loaded when needed, and can even be skipped
Cons:
  - Boilerplate: `const logger = await loggerFactory(pluginId)`
  - Dafuq is `loggerFactory('root')`? Even `loggerFactory(ROOT_PLUGIN_ID)` is strange.
  - A lot is left up for interpretation by the factories, e.g. how to handle the root plugin
  - The factory type is a nested function (some extra complexity)

Tweaked model: factory(depFactories) => (pluginId?: string) => impl
Pros:
  - A bit cleaner to do `loggerFactory()`
Cons:
  - Implementer might skip pluginId entirely by mistake

Double deps model: factory(rootDeps) => (pluginDeps, pluginsId?: string) => impl
Pros:
  - Less boilerplate to access dependencies
Cons:
  - Unclear what it means to consume both versions of a dep
  - Do all services have both root and plugin versions? Probably not, how do you know which ones do?


Explicit root deps: factory(deps) => impl, serviceRef{scope=root} vs serviceRef{scope=plugin}
Pros:
  - Clear separation between root and plugin scoped services
Cons:
  - No easy way to keep global state in the factory





MUST HAVE:
  - Possibility for services to have global state


DO NOT WANT:
  - Boilerplate
  - 'root' | ROOT_PLUGIN_ID
  - const config = await configFactory()
  - The need to create a service for boilerplate-y reasons



*/
