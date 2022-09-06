/*
 * Copyright 2022 The Backstage Authors
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

/**
 * TODO
 *
 * @public
 */
export type ServiceRef<
  TService,
  TScope extends 'root' | 'plugin' = 'root' | 'plugin',
> = {
  id: string;

  /**
   * I WILL FILL THIS IN OR EAT MY SHOE
   */
  scope: TScope;

  /**
   * Utility for getting the type of the service, using `typeof serviceRef.T`.
   * Attempting to actually read this value will result in an exception.
   */
  T: TService;

  toString(): string;

  $$ref: 'service';
};

/** @public */
export type TypesToServiceRef<T> = { [key in keyof T]: ServiceRef<T[key]> };

/** @public */
export type FactoryFunc<Impl> = (pluginId: string) => Promise<Impl>;

/** @public */
export type ServiceFactory<TService = unknown> =
  | {
      service: ServiceRef<TService, 'root'>;
      deps: { [key in string]: ServiceRef<unknown> };
      factory(deps: { [key in string]: unknown }): Promise<TService>;
    }
  | {
      service: ServiceRef<TService, 'plugin'>;
      deps: { [key in string]: ServiceRef<unknown> };
      factory(deps: { [key in string]: unknown }): Promise<
        (deps: { [key in string]: unknown }) => Promise<TService>
      >;
    };

/**
 * @public
 */
export function createServiceRef<T>(options: {
  id: string;
  scope?: 'plugin';
  defaultFactory?: (
    service: ServiceRef<T>,
  ) => Promise<ServiceFactory<T> | (() => ServiceFactory<T>)>;
}): ServiceRef<T, 'plugin'>;
export function createServiceRef<T>(options: {
  id: string;
  scope: 'root';
  defaultFactory?: (
    service: ServiceRef<T>,
  ) => Promise<ServiceFactory<T> | (() => ServiceFactory<T>)>;
}): ServiceRef<T, 'root'>;
export function createServiceRef<T>(options: {
  id: string;
  scope?: 'plugin' | 'root';
  defaultFactory?: (
    service: ServiceRef<T>,
  ) => Promise<ServiceFactory<T> | (() => ServiceFactory<T>)>;
}): ServiceRef<T, 'plugin' | 'root'> {
  const { id, scope = 'plugin', defaultFactory } = options;
  return {
    id,
    scope,
    get T(): T {
      throw new Error(`tried to read ServiceRef.T of ${this}`);
    },
    toString() {
      return `serviceRef{${options.id}}`;
    },
    $$ref: 'service', // TODO: declare
    __defaultFactory: defaultFactory,
  } as ServiceRef<T, typeof scope> & {
    __defaultFactory?: (
      service: ServiceRef<T>,
    ) => Promise<ServiceFactory<T> | (() => ServiceFactory<T>)>;
  };
}

type OnlyRootScopeDependencies<
  TDeps extends { [key in string]: ServiceRef<unknown> },
> = Pick<
  TDeps,
  {
    [name in keyof TDeps]: TDeps[name]['scope'] extends 'root' ? name : never;
  }[keyof TDeps]
>;

type DependencyRefsToInstances<
  T extends { [key in string]: ServiceRef<unknown> },
> = {
  [key in keyof T]: T[key] extends ServiceRef<infer TImpl> ? TImpl : never;
};

/**
 * @public
 */
export function createServiceFactory<
  TService,
  TScope extends 'root' | 'plugin',
  TImpl extends TService,
  TDeps extends { [name in string]: ServiceRef<unknown> },
  TOpts extends { [name in string]: unknown } | undefined = undefined,
>(config: {
  service: ServiceRef<TService, TScope>;
  deps: TDeps;
  factory(
    deps: DependencyRefsToInstances<OnlyRootScopeDependencies<TDeps>>,
    options: TOpts,
  ): TScope extends 'root'
    ? Promise<TImpl>
    : Promise<(deps: DependencyRefsToInstances<TDeps>) => Promise<TImpl>>;
}): undefined extends TOpts
  ? (options?: TOpts) => ServiceFactory<TService>
  : (options: TOpts) => ServiceFactory<TService> {
  return (options?: TOpts) =>
    ({
      service: config.service,
      deps: config.deps,
      factory(
        deps: DependencyRefsToInstances<OnlyRootScopeDependencies<TDeps>>,
      ) {
        return config.factory(deps, options!);
      },
    } as ServiceFactory<TService>);
}
