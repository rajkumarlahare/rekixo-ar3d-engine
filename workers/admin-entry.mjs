import adminWorker from "./admin.mjs";
import { handleSourceVerificationRequest } from "./source-verification.mjs";
import { handleSourceUploadRequest } from "./source-upload.mjs";

export { DwgProcessor } from "./dwg-processor-container.mjs";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const verificationResponse = await handleSourceVerificationRequest(
      request,
      env,
      url,
    );
    if (verificationResponse) return verificationResponse;

    const sourceResponse = await handleSourceUploadRequest(request, env, url);
    if (sourceResponse) return sourceResponse;
    return adminWorker.fetch(request, env, ctx);
  },
};
