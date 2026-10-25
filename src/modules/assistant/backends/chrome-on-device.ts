import { ON_DEVICE_PROVIDER, OnDeviceConnection, onDeviceModels } from "../../../lib/on-device";
import { defineBackend } from "../backend";

// Chrome's built-in model (the Prompt API), where the browser has it: private
// and offline, for one post at a time, with no tools beyond proposing edits.
export default defineBackend({
  id: "chrome-on-device",
  name: "On this device",
  order: 20,
  providers: [ON_DEVICE_PROVIDER],
  models: async () => ({ models: await onDeviceModels() }),
  connect: (_settings, sessionId) => new OnDeviceConnection(sessionId),
});
