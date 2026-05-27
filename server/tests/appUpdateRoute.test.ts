import { test } from "node:test";
import assert from "node:assert/strict";

import { createApiRouter } from "../src/apiRoutes.js";

test("createApiRouter: /app/android/publish checks auth before raw body parsing", () => {
  const router = createApiRouter() as unknown as {
    stack: Array<{
      route?: {
        path: string;
        stack: Array<{ name: string }>;
      };
    }>;
  };

  const publishRoute = router.stack.find((layer) => layer.route?.path === "/app/android/publish")?.route;
  assert.ok(publishRoute, "publish route should exist");

  const middlewareNames = publishRoute.stack.map((layer) => layer.name);
  assert.equal(middlewareNames[0], "androidUpdatePublishPreAuth");
  assert.equal(middlewareNames[1], "rawParser");
  assert.equal(middlewareNames[2], "handleAndroidUpdatePublish");
});
