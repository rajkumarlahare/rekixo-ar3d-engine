import adminWorker from "./admin.mjs";
import { handleSourceUploadRequest } from "./source-upload.mjs";

export { DwgProcessor } from "./dwg-processor-container.mjs";

export default {
  async fetch(request, env, ctx) {
    const sourceResponse = await handleSourceUploadRequest(
      request,
      env,
      new URL(request.url),
    );
    if (sourceResponse) return sourceResponse;
    return adminWorker.fetch(request, env, ctx);
  },
};
