# Baileys top-level status acknowledgement patch

This build-time workaround addresses the recurring `stream errored out` failure with
`ack class="status"` reported for Evolution API 2.3.7 and Baileys 7.0.0-rc.9.

References:
- Evolution API issue: https://github.com/evolution-foundation/evolution-api/issues/2778
- Baileys issue: https://github.com/WhiskeySockets/Baileys/issues/2858
- Evolution API patch proposal: https://github.com/evolution-foundation/evolution-api/pull/2788

## What the patch changes

The build script modifies only the installed Baileys receive socket file:

`node_modules/baileys/lib/Socket/messages-recv.js`

It:
1. Acknowledges top-level `<status>` stanzas without a NACK.
2. Routes offline status stanzas through the offline node processor.
3. Catches an individual offline-node processing error so one bad node does not stop the remaining queue.

Evolution API does not decode these top-level status stanzas as customer messages. The patch acknowledges them so they do not remain pending and cause the WhatsApp stream to close.

## Build behaviour and safeguards

- The script runs in the Docker builder after `npm ci` and before `npm run build`.
- It applies only to Baileys `7.0.0-rc.9`. A different version fails the build for review rather than silently applying an unverified patch.
- It checks that every expected source anchor occurs exactly once before writing.
- It is idempotent and verifies an already-applied patch.
- It runs `node --check` on the patched file. If syntax validation fails, it restores the original file and fails the build.
- No database schema, WhatsApp credentials, stored sessions or n8n workflows are changed by this patch.

## Validation required before production

1. Build the Docker image from this branch.
2. Confirm the build log contains the successful `[status-ack-patch]` message.
3. Run the image in an isolated staging service with a test WhatsApp session.
4. Verify inbound text and media messages reach the configured webhook.
5. Observe the connection for at least 60 minutes and confirm there are no repeated `ack class="status"` stream errors.
6. Confirm offline messages are processed and the queue continues after an individual node error.

Do not deploy this branch to the production Railway service until the image build and staging checks pass and production deployment is separately approved.

## Rollback

Revert the Dockerfile changes that copy and run this patch script, then rebuild from the previous known-good source revision. Do not delete or reset the production WhatsApp session or database as part of rollback.
