import type { INestApplicationContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { z, type ZodType } from 'zod';
// Importing the contracts registers every schema (with its id) in zod's global registry.
import '@jengalink/contracts';
import { CONTRACT_METADATA, type RouteContract } from '../common/contract';

const METHODS = [
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'all',
  'options',
  'head',
] as const;

export interface DiscoveredRoute {
  method: (typeof METHODS)[number];
  path: string;
  isPublic: boolean;
  contract?: RouteContract;
  idempotency?: { required: boolean };
}

/** Every route the app serves, read from controller metadata (also used by the security tests). */
export function discoverRoutes(
  app: INestApplicationContext,
): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as unknown as {
        prototype: Record<string, unknown>;
      } | null;
      if (!ctrl) continue;
      const base = (Reflect.getMetadata(PATH_METADATA, ctrl) as string) ?? '';
      const classPublic = Reflect.getMetadata('isPublic', ctrl) === true;
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = ctrl.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;
        if (sub === undefined) continue;
        const joined =
          `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(
            /\/+/g,
            '/',
          );
        routes.push({
          method:
            METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number],
          path: joined === '/health' ? joined : `/v1${joined}`,
          isPublic:
            classPublic || Reflect.getMetadata('isPublic', handler) === true,
          contract: Reflect.getMetadata(CONTRACT_METADATA, handler) as
            RouteContract | undefined,
          idempotency: Reflect.getMetadata('idempotency', handler) as
            { required: boolean } | undefined,
        });
      }
    }
  }
  return routes.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

const idOf = (schema: ZodType): string => {
  const id = (z.globalRegistry.get(schema) as { id?: string } | undefined)?.id;
  if (!id) throw new Error('Contract schemas must have .meta({ id })');
  return id;
};
const ref = (schema: ZodType) => ({
  $ref: `#/components/schemas/${idOf(schema)}`,
});
const errorRef = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiErrorBody' },
    },
  },
});

/** OpenAPI 3.1 document generated from routes, contracts and the zod schemas. */
export function buildOpenApi(app: INestApplicationContext, version: string) {
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: 'any',
  }) as { schemas: Record<string, Record<string, unknown>> };
  // Each component is self-contained; drop the per-schema $id/$schema noise.
  for (const s of Object.values(schemas)) {
    delete s.$id;
    delete s.$schema;
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of discoverRoutes(app)) {
    const c = r.contract;
    if (!c)
      throw new Error(`${r.method.toUpperCase()} ${r.path} has no @Contract`);
    const openPath = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const params: Record<string, unknown>[] = [
      ...r.path.matchAll(/:([A-Za-z]+)/g),
    ].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema:
        name === 'token'
          ? { type: 'string' }
          : { type: 'string', format: 'uuid' },
    }));
    for (const [name, schema] of Object.entries(c.query?.shape ?? {})) {
      const json = z.toJSONSchema(schema as ZodType, { io: 'input' });
      delete json.$schema;
      params.push({
        name,
        in: 'query',
        required: !(schema as ZodType).safeParse(undefined).success,
        schema: json,
      });
    }
    if (r.idempotency) {
      params.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: r.idempotency.required,
        description:
          'A retry with the same key and body returns the original result instead of acting twice.',
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,255}$' },
      });
    }
    if (c.ifMatch) {
      params.push({
        name: 'If-Match',
        in: 'header',
        required: true,
        description:
          'The revision you are changing, as returned in the ETag header.',
        schema: { type: 'string', example: '"3"' },
      });
    }

    const status = String(c.status ?? (c.response ? 200 : 204));
    const responses: Record<string, unknown> = {
      [status]: c.response
        ? {
            description: 'Success',
            content: {
              'application/json': {
                schema: c.list
                  ? { type: 'array', items: ref(c.response) }
                  : ref(c.response),
              },
            },
          }
        : { description: 'Done' },
    };
    if (c.body || params.length) responses['400'] = errorRef('Invalid request');
    if (!r.isPublic)
      responses['401'] = errorRef('Sign in required, or the session ended');
    if (/:id/.test(r.path)) {
      responses['403'] = errorRef('Your role does not allow this');
      responses['404'] = errorRef('Not found, or not shared with you');
    }
    if (r.method !== 'get')
      responses['409'] = errorRef('Conflicts with the current state');
    if (c.ifMatch) {
      responses['412'] = errorRef('Changed by someone else since you read it');
      responses['428'] = errorRef('If-Match header missing');
    }
    if (r.path.startsWith('/v1/auth/otp'))
      responses['429'] = errorRef('Too many attempts; see retryAfterSeconds');

    paths[openPath] ??= {};
    paths[openPath][r.method] = {
      tags: [c.tag],
      summary: c.summary,
      operationId: `${r.method}${openPath.replace(/[{}]/g, '').replace(/(^|[/-])(\w)/g, (_m, _s, ch: string) => ch.toUpperCase())}`,
      ...(r.isPublic ? { security: [] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(c.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: ref(c.body) } },
            },
          }
        : {}),
      responses,
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'JengaLink API',
      version,
      description:
        'Construction project platform API. Every error uses ApiErrorBody; every response carries x-request-id. ' +
        'JengaLink records construction payments but never moves construction money.',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas,
    },
    paths,
  };
}
