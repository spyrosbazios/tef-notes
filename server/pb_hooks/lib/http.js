// How every TEF Notes route (a `routerAdd` in pb_hooks) answers a failure: a 4xx or 5xx with `{ error }`, one sentence fit
// to show the owner, and nothing else. Clients read it with one reader, packages/core/src/record-contracts.ts `serverError`.
// test/http.test.js holds the hooks to it: no route answers `{ message }` or throws PocketBase's ApiErrors.
//
// PocketBase's own record API answers `{ message }` (with `data` naming the field), and so do the request hooks that refuse
// a write inside it (rev.pb.js, notes.pb.js, links.pb.js): that is PocketBase's shape, which `serverError` reads too.
//
// Plain CommonJS: a handler `require`s it (a handler runs in a VM of its own and sees none of its file's top level).

/** `handle()`'s answer; when it throws, the throw logged under `tag` and a 500 `{ error: what }`, never PocketBase's
 *  `{ message }`. A route's expected failures (a bad body, a refused URL) are answered by the route itself. */
function route(e, tag, what, handle) {
  try {
    return handle();
  } catch (err) {
    e.app.logger().error(`${tag}: ${what}`, "error", String(err).slice(0, 300));
    return e.json(500, { error: what });
  }
}

module.exports = { route };
