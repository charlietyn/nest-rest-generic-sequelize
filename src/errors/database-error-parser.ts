import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Translates raw Sequelize / driver errors into human-friendly HTTP exceptions —
 * the TypeScript counterpart of the original `DatabaseErrorParser`. Recognizes
 * Sequelize's typed errors plus PostgreSQL (SQLSTATE) and MySQL (errno) codes.
 *
 * @author Charlietyn (TypeScript/Sequelize port)
 */
export interface ParsedDbError {
  type: string;
  message: string;
  status: number;
  fields?: Record<string, unknown>;
  detail?: string;
}

export class DatabaseErrorParser {
  static parse(error: unknown): ParsedDbError {
    const err = error as {
      name?: string;
      message?: string;
      errors?: { message: string; path?: string }[];
      fields?: Record<string, unknown>;
      original?: { code?: string; errno?: number; detail?: string; message?: string };
    };
    const name = err?.name ?? '';
    const original = err?.original ?? {};
    const code = String(original.code ?? '');
    const errno = Number(original.errno ?? NaN);
    const detail = original.detail;

    // --- Sequelize typed errors ------------------------------------------
    if (name === 'SequelizeUniqueConstraintError') {
      const fieldNames = Object.keys(err.fields ?? {}).join(', ');
      return {
        type: 'unique_violation',
        status: 409,
        message: fieldNames
          ? `A record with these values already exists (${fieldNames}).`
          : 'A record with these values already exists.',
        fields: err.fields,
        detail,
      };
    }
    if (name === 'SequelizeForeignKeyConstraintError') {
      return {
        type: 'foreign_key_violation',
        status: 409,
        message:
          'This operation references a related record that does not exist, ' +
          'or the record is still referenced by others.',
        detail,
      };
    }
    if (name === 'SequelizeValidationError') {
      const messages = (err.errors ?? []).map((e) => e.message);
      return {
        type: 'validation_error',
        status: 422,
        message: messages.length ? messages.join('; ') : 'Validation failed.',
      };
    }

    // --- PostgreSQL SQLSTATE ---------------------------------------------
    switch (code) {
      case '23505':
        return { type: 'unique_violation', status: 409, message: 'A record with these values already exists.', detail };
      case '23503':
        return { type: 'foreign_key_violation', status: 409, message: 'This operation violates a foreign key constraint.', detail };
      case '23502':
        return { type: 'not_null_violation', status: 422, message: 'A required field cannot be null.', detail };
      case '22001':
        return { type: 'value_too_long', status: 422, message: 'A value is too long for its column.' };
      case '22003':
        return { type: 'out_of_range', status: 422, message: 'A numeric value is out of range.' };
      case '22P02':
        return { type: 'invalid_input', status: 400, message: 'A value has an invalid format for its column type.' };
      case '42703':
        return { type: 'undefined_column', status: 400, message: 'Unknown column referenced in the query.' };
    }

    // --- MySQL / MariaDB errno -------------------------------------------
    switch (errno) {
      case 1062:
        return { type: 'unique_violation', status: 409, message: 'A record with these values already exists.' };
      case 1451:
      case 1452:
        return { type: 'foreign_key_violation', status: 409, message: 'This operation violates a foreign key constraint.' };
      case 1048:
        return { type: 'not_null_violation', status: 422, message: 'A required field cannot be null.' };
      case 1406:
        return { type: 'value_too_long', status: 422, message: 'A value is too long for its column.' };
      case 1054:
        return { type: 'undefined_column', status: 400, message: 'Unknown column referenced in the query.' };
    }

    return {
      type: 'database_error',
      status: 500,
      message: 'An unexpected database error occurred.',
      detail: original.message ?? err?.message,
    };
  }

  static toException(parsed: ParsedDbError): HttpException {
    const body = { success: false, error: parsed.type, message: parsed.message, detail: parsed.detail };
    switch (parsed.status) {
      case 400:
        return new BadRequestException(body);
      case 409:
        return new ConflictException(body);
      case 422:
        return new UnprocessableEntityException(body);
      default:
        return new InternalServerErrorException(body);
    }
  }

  static handle(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    return this.toException(this.parse(error));
  }
}
