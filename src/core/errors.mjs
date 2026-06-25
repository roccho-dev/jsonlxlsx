const errorName = 'CompileError';

function makeCompileError(message, details) {
  const err = new Error(message);
  err.name = errorName;
  if (details !== undefined) err.details = details;
  return err;
}

function fail(message, details) {
  throw makeCompileError(message, details);
}

function assert(condition, message, details) {
  if (!condition) fail(message, details);
}

export { errorName as CompileErrorName, makeCompileError, fail, assert };
