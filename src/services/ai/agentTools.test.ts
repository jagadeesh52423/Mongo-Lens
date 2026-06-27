import { describe, it, expect } from 'vitest';
import { RUN_MONGO_TOOL, classifyStatement } from './agentTools';

describe('RUN_MONGO_TOOL', () => {
  it('is a single tool with a statement string param', () => {
    expect(RUN_MONGO_TOOL.name).toBe('runMongo');
    expect((RUN_MONGO_TOOL.parameters as any).properties.statement.type).toBe('string');
  });
});

describe('classifyStatement', () => {
  it('marks find/aggregate as non-destructive', () => {
    expect(classifyStatement('db.users.find({})').destructive).toBe(false);
    expect(classifyStatement('db.o.aggregate([{ $match: {} }])').destructive).toBe(false);
  });
  it('marks writes/drops as destructive', () => {
    expect(classifyStatement('db.users.deleteMany({})').destructive).toBe(true);
    expect(classifyStatement('db.users.drop()').destructive).toBe(true);
  });
  it('treats multi-statement input as destructive (cannot auto-classify a batch)', () => {
    expect(classifyStatement('db.a.find(); db.b.drop()').destructive).toBe(true);
  });
  it('treats unknown/unclassifiable as destructive (fail-safe)', () => {
    expect(classifyStatement('db.users.frobnicate()').destructive).toBe(true);
  });
});
