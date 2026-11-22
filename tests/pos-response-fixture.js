// Build the committed response for an intercepted same-origin write in browser tests.
export function acknowledged(route, snapshot, id, replayed = false) {
  const request = route.request();
  return { ...snapshot, result: { id }, confirmation: {
    operationId: request.headers()['idempotency-key'], databaseId: request.postDataJSON().databaseId,
    method: request.method(), path: new URL(request.url()).pathname, replayed,
  } };
}
