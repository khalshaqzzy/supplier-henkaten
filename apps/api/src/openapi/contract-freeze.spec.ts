import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { buildOpenApiDocument } from './document.js';

describe('backend contract freeze', () => {
  it('documents every registered HTTP controller operation exactly once', () => {
    const implemented = controllerOperations(AppModule);
    const documented = openApiOperations(buildOpenApiDocument());

    expect({
      undocumented: [...implemented].filter((operation) => !documented.has(operation)).sort(),
      unimplemented: [...documented].filter((operation) => !implemented.has(operation)).sort(),
    }).toEqual({ undocumented: [], unimplemented: [] });
  });

  it('keeps the public document on the frozen v1 and OpenAPI 3.1 boundary', () => {
    const document = buildOpenApiDocument() as {
      openapi: string;
      info: { version: string };
      paths: Record<string, Record<string, unknown>>;
    };

    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe('1.0.0');
    expect(Object.keys(document.paths).length).toBe(130);
    expect(openApiOperations(document).size).toBe(146);
  });
});

function controllerOperations(root: object): Set<string> {
  const modules = collectModules(root);
  const operations = new Set<string>();
  for (const moduleType of modules) {
    const controllers =
      (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleType) as object[] | undefined) ?? [];
    for (const controller of controllers) {
      const controllerPaths = paths(Reflect.getMetadata(PATH_METADATA, controller));
      const prototype = (controller as { prototype: object }).prototype;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === 'constructor') continue;
        const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value as
          object | undefined;
        if (!handler) continue;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (requestMethod === undefined) continue;
        const method = requestMethodName(requestMethod);
        for (const controllerPath of controllerPaths) {
          for (const methodPath of paths(Reflect.getMetadata(PATH_METADATA, handler))) {
            const route = normalizePath(`${controllerPath}/${methodPath}`);
            const key = `${method} ${route}`;
            if (operations.has(key)) throw new Error(`Duplicate implemented operation: ${key}`);
            operations.add(key);
          }
        }
      }
    }
  }
  return operations;
}

function collectModules(root: object): Set<object> {
  const visited = new Set<object>();
  const visit = (candidate: object) => {
    const moduleType =
      'module' in candidate && typeof candidate.module === 'function'
        ? candidate.module
        : candidate;
    if (visited.has(moduleType)) return;
    visited.add(moduleType);
    const imports =
      (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) as object[] | undefined) ?? [];
    for (const imported of imports) {
      if (typeof imported === 'function' || (imported && typeof imported === 'object')) {
        visit(imported);
      }
    }
  };
  visit(root);
  return visited;
}

function openApiOperations(document: Record<string, unknown>): Set<string> {
  const paths = document['paths'] as Record<string, Record<string, unknown>>;
  const operations = new Set<string>();
  for (const [path, definition] of Object.entries(paths)) {
    for (const method of Object.keys(definition)) {
      if (!HTTP_METHODS.has(method)) continue;
      const key = `${method.toUpperCase()} ${normalizePath(path)}`;
      if (operations.has(key)) throw new Error(`Duplicate documented operation: ${key}`);
      operations.add(key);
    }
  }
  return operations;
}

const HTTP_METHODS = new Set(['delete', 'get', 'patch', 'post', 'put']);

function requestMethodName(method: RequestMethod): string {
  const value = RequestMethod[method];
  if (!value || value === 'ALL') throw new Error(`Unsupported request method metadata: ${method}`);
  return value;
}

function paths(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [typeof value === 'string' ? value : ''];
}

function normalizePath(value: string): string {
  const normalized = `/${value}`.replaceAll(/\/+/g, '/').replaceAll(/:([A-Za-z0-9_]+)/g, '{$1}');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}
