declare module "node:sqlite" {
  export type SqliteValue = string | number | bigint | Uint8Array | null;

  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    public run(...params: SqliteValue[]): RunResult;
    public get(...params: SqliteValue[]): unknown;
    public all(...params: SqliteValue[]): unknown[];
  }

  export class DatabaseSync {
    public constructor(location: string);
    public exec(sql: string): void;
    public prepare(sql: string): StatementSync;
    public close(): void;
  }
}

