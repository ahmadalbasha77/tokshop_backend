# Notifications Audit Issues

Audit date: 2026-06-06

Status: Open

This document records notification-system issues found during a read-only
backend audit. No notification behavior was changed as part of this audit.

## Critical

### 1. Notification APIs lack resource-level authorization

Files:

- `src/routes/notification.js`
- `src/routes/activities.js`

Details:

- Any authenticated user can update or read another user's notification
  settings by providing their user ID.
- Any authenticated user can call `POST /notifications` and send push
  notifications to arbitrary user IDs.
- Activity routes allow authenticated users to read, create, update, or delete
  activity records without checking ownership or an admin role.

Required resolution:

- Restrict settings operations to the authenticated user or an authorized
  admin.
- Restrict manual notification sending to trusted server flows or admins.
- Add ownership and role checks to activity routes.

### 2. Firebase credential is not deployed by the workflow

Files:

- `src/shared/send_notification.js`
- `.github/workflows/deploy.yml`

Details:

- Firebase initialization requires `service_account.json`.
- The file is not tracked locally and is not included in the deployment source
  list.
- Production probably works because an older copy remains on the server.
- A clean deployment or a new server can fail during application startup.

Required resolution:

- Store Firebase credentials as deployment secrets.
- Generate the credential file securely during deployment, or initialize
  Firebase from protected environment variables.
- Never commit the service-account private key.

## High

### 3. APIs report success before Firebase confirms delivery

Files:

- `src/shared/send_notification.js`
- `src/shared/functions.js`

Details:

- `sendPushNotification()` does not return the
  `sendEachForMulticast()` promise.
- `functions.sendNotification()` does not return or await the underlying send.
- Callers can return HTTP success while Firebase later rejects the message.
- Calling `await functions.sendNotification()` currently does not wait for FCM.

Required resolution:

- Return and await the Firebase promise.
- Return a structured result containing success count, failure count, and
  per-token failures.
- Decide explicitly which business operations should fail when push delivery
  fails and which should only log the failure.

### 4. Invalid and empty tokens are not filtered

File:

- `src/shared/send_notification.js`

Details:

- `null`, `undefined`, empty, duplicate, and stale tokens can reach Firebase.
- Failed or expired tokens are logged but never removed from the user record.
- Some callers pass `[undefined]` because related user data was not populated.

Required resolution:

- Normalize, filter, and deduplicate tokens before sending.
- Handle `messaging/registration-token-not-registered` and other confirmed
  invalid-token responses.
- Remove invalid tokens or mark them inactive.
- Store a token-updated timestamp and refresh it from Flutter.

### 5. Firebase multicast limit is not handled

File:

- `src/shared/send_notification.js`

Details:

- Firebase accepts a maximum of 500 registration tokens per multicast request.
- Live-room and scheduled notifications can exceed this limit.

Required resolution:

- Split token arrays into batches of at most 500.
- Aggregate results from all batches.

### 6. FCM data payload values are not normalized to strings

Affected examples:

- `src/controllers/shipping.js`
- `src/shared/jobs.js`
- `src/controllers/rooms.js`

Details:

- FCM custom data keys and values must be strings.
- Some calls pass MongoDB ObjectIds or `null`, which can reject the complete
  message.

Required resolution:

- Convert supported payload values to strings centrally.
- Remove `null` and `undefined` values.
- Validate the payload before calling Firebase.

## Confirmed Broken Notification Flows

### 7. Counter-offer rejection passes the wrong arguments

File:

- `src/controllers/offers.js`

Details:

- The rejection flow passes an empty string as the fourth argument.
- The intended data object is passed as a fifth argument and is ignored.
- Firebase receives an invalid or incomplete `data` payload.

Required resolution:

- Pass the navigation data object as the fourth argument.
- Add a focused test for counter-offer acceptance and rejection notifications.

### 8. Rejected item-cancellation notification has no customer token

File:

- `src/controllers/orders.js`

Details:

- The item cancellation rejection query populates only the customer username.
- The code then reads `orderItem.customer.fcmToken`.
- The token is therefore undefined and the notification is not delivered.

Required resolution:

- Populate the required customer token.
- Do not send when no valid token exists.

### 9. Delivered-order notification has no populated seller

File:

- `src/controllers/shipping.js`

Details:

- The delivered-order update does not populate `seller`.
- The code reads `order.seller.fcmToken` even though `seller` is an ObjectId.
- Both transit and delivered payloads pass a MongoDB ObjectId as `data.id`.

Required resolution:

- Populate the seller token or query it explicitly.
- Convert the order ID to a string.
- Add webhook tests for transit and delivered states.

### 10. Live category followers are added as a nested array

File:

- `src/socket/handlers/room.handlers.js`

Details:

- Category followers are pushed into the owner-followers array as one nested
  array.
- The later loop expects individual users, so category followers are skipped.
- Invited hosts receive notifications without checking live-notification
  preferences.
- `usersNotified` and `notificationsent` overlap and are updated
  inconsistently.

Required resolution:

- Merge follower arrays correctly.
- Define whether invited-host preferences should be respected.
- Use one notification-sent flag with clear semantics.

### 11. Scheduled account-reactivation notification can be rejected

File:

- `src/shared/jobs.js`

Details:

- The scheduled job includes all stored tokens without filtering.
- It sends `id: null` inside the FCM data payload.
- Separately, the job currently selects every suspended user each minute
  without an apparent suspension-expiry condition. This behavior requires a
  dedicated business-logic review.

Required resolution:

- Filter tokens and remove the null data value.
- Verify and enforce the intended suspension end-date condition.

## Medium

### 12. Notification preferences are only partially implemented

Files:

- `src/models/user.js`
- Notification call sites across controllers and socket handlers

Details:

- `notify_on_follow` is checked for follow notifications.
- `notify_on_order` is checked in only part of the order flow.
- `notify_on_live` is checked for some live followers.
- `notify_on_message` is not used by the backend.
- Offers, tips, shipping, disputes, cancellation, approval, and suspension
  notifications commonly ignore user preferences.

Required resolution:

- Define a notification type for every push event.
- Enforce preferences in one centralized notification service.
- Document notifications that must always be sent for security or legal
  reasons.

### 13. Topic broadcast cannot be verified from the backend

Files:

- `src/shared/send_notification.js`
- `src/controllers/rooms.js`

Details:

- Global room notifications are sent to the Firebase topic `all`.
- The backend contains no subscription logic for this topic.
- Delivery depends on Flutter subscribing and re-subscribing every current
  token to `all`.

Required resolution:

- Verify Flutter topic subscription on initial startup and token refresh.
- Alternatively, manage topic subscription from the backend.
- Ensure the room ID is sent as a string.

### 14. FCM token storage has no dedicated contract

Files:

- `src/controllers/users.js`
- `src/routes/user.js`

Details:

- Flutter appears to store `fcmToken` through the generic user-update endpoint.
- There is no dedicated token registration/removal endpoint or token timestamp.
- The generic endpoint accepts arbitrary user fields and needs a separate
  authorization and field-allowlist review.

Required resolution:

- Add authenticated register, refresh, and unregister token operations.
- Support multiple devices per user if required.
- Store platform and update timestamp.

### 15. Activity history is not synchronized with push delivery

Files:

- `src/shared/functions.js`
- `src/controllers/activity.js`

Details:

- Only some push events create an activity record.
- Activity save errors are silently ignored.
- A successful activity does not mean push delivery succeeded, and the reverse
  is also true.

Required resolution:

- Define which events must appear in the in-app notification history.
- Log activity persistence failures.
- Use consistent event IDs and notification types.

## Observability And Privacy

### 16. Sensitive device tokens are written to logs

Files:

- `src/shared/send_notification.js`
- Some notification call sites

Details:

- Complete notification objects and Firebase tokens are printed to application
  logs.
- Failed Firebase responses are not recorded in a structured, queryable form.

Required resolution:

- Redact tokens in logs.
- Add structured event logs with notification type, recipient user ID, result,
  and safe Firebase error code.
- Add delivery counters and alerting for unusual failure rates.

## Flutter Verification Checklist

The backend audit cannot verify these client-side requirements:

- Request Android and iOS notification permissions.
- Retrieve the FCM token at startup and after login.
- Send token updates to the backend whenever `onTokenRefresh` fires.
- Remove or invalidate the token on logout.
- Create Android channel `default_channel`.
- Handle foreground, background, and terminated notification states.
- Route `screen` and `id` payload values safely.
- Subscribe every token to the `all` topic if topic broadcasting remains in
  use.
- Confirm APNs credentials are configured in the Firebase project for iOS.

## Recommended Implementation Order

1. Secure notification, activity, and user-update endpoints.
2. Replace the Firebase credential deployment mechanism.
3. Centralize token filtering, string payload conversion, batching, awaiting,
   and failure handling.
4. Repair the confirmed broken offer, order, shipping, live, and scheduled
   flows.
5. Apply notification preferences consistently.
6. Add token lifecycle management and Flutter verification.
7. Add automated tests and production delivery monitoring.

## Verification Notes

- JavaScript syntax checks passed for the inspected notification files.
- No real push notification was sent during the audit.
- Local runtime delivery could not be tested because dependencies and
  `service_account.json` were not available in the local workspace.
- Production delivery must be tested using dedicated test users and devices,
  not real customer accounts.

## Firebase References

- Sending messages:
  https://firebase.google.com/docs/cloud-messaging/send/admin-sdk
- Registration token management:
  https://firebase.google.com/docs/cloud-messaging/manage-tokens
- Node.js messaging reference:
  https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging
