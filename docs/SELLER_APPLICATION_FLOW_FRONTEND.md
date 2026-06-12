# Seller Application Flow - Flutter Integration Guide

## Summary

Seller application is now separated from Stripe Connect.

The app must no longer collect bank, payout, SSN, phone, or date of birth fields during seller application submission. Those fields belong only to the later payout setup step.

New flow:

1. User accepts seller guidelines.
2. User enters full address.
3. User may optionally add social links and seller questions.
4. Backend submits seller application without calling Stripe.
5. Admin approves or rejects the application.
6. After approval, seller may still have incomplete payout/profile information.
7. When seller tries actions that require payout/profile completion, backend returns `SELLER_PROFILE_INCOMPLETE`.
8. Flutter should then send seller to the Stripe Connect / payout setup screen.

## Do Not Use Stripe Connect For Seller Application

Do not use this endpoint for initial seller application anymore:

`POST /stripe/connect/:id`

That endpoint is still supported, but only after seller approval, when the seller is completing payout/bank/KYC information.

## New Seller Application Endpoint

### Path

`POST /users/seller/application`

Alternative path if submitting for a specific user:

`POST /users/seller/application/:id`

Both routes require the normal authenticated user token because `/users` routes are protected.

### Required Request Fields

```json
{
  "seller_guidelines_accepted": true,
  "address_line_1": "123 Main St",
  "city": "San Francisco",
  "state": "CA",
  "country": "United States",
  "postal_code": "94117"
}
```

### Optional Request Fields

```json
{
  "address_line_2": "Apt 4",
  "instagram_link": "https://instagram.com/example",
  "tiktok_link": "https://tiktok.com/@example",
  "facebook_link": "https://facebook.com/example",
  "website_link": "https://example.com",
  "has_livestream_experience": true,
  "referral_source": "Friend"
}
```

`has_livestream_experience` may be `true`, `false`, or `null`.

### Full Example Request

```json
{
  "seller_guidelines_accepted": true,
  "address_line_1": "123 Main St",
  "address_line_2": "Apt 4",
  "city": "San Francisco",
  "state": "CA",
  "country": "United States",
  "postal_code": "94117",
  "instagram_link": "",
  "tiktok_link": "",
  "facebook_link": "",
  "website_link": "",
  "has_livestream_experience": null,
  "referral_source": ""
}
```

### Minimal Valid Request

This is enough to submit:

```json
{
  "seller_guidelines_accepted": true,
  "address_line_1": "123 Main St",
  "city": "San Francisco",
  "state": "CA",
  "country": "United States",
  "postal_code": "94117"
}
```

### Fields That Must Not Be Sent

Do not send these fields to the seller application endpoint:

```json
[
  "routing_number",
  "account_number",
  "bank_account_number",
  "ssn_last_4",
  "date_of_birth",
  "phone",
  "iban",
  "payout_account",
  "payment_details"
]
```

If Flutter sends these fields, backend returns `400`.

## Success Response

HTTP `201`

```json
{
  "success": true,
  "message": "Seller application submitted successfully.",
  "seller_application": {
    "status": "pending",
    "seller_guidelines_accepted": true,
    "guidelines_accepted_at": "2026-05-07T10:00:00.000Z",
    "instagram_link": "",
    "tiktok_link": "",
    "facebook_link": "",
    "website_link": "",
    "has_livestream_experience": null,
    "referral_source": "",
    "submitted_at": "2026-05-07T10:00:00.000Z",
    "reviewed_at": null,
    "reviewed_by": null,
    "rejection_reason": ""
  },
  "address": {
    "_id": "ADDRESS_ID",
    "addrress1": "123 Main St",
    "addrress2": "",
    "city": "San Francisco",
    "state": "CA",
    "country": "United States",
    "zipcode": "94117",
    "primary": true
  }
}
```

Note: address model uses legacy field spellings in the response:

- `addrress1` = `address_line_1`
- `addrress2` = `address_line_2`
- `zipcode` = `postal_code`

## Validation Errors

### Guidelines Not Accepted

HTTP `422`

```json
{
  "success": false,
  "message": "seller_guidelines_accepted must be true.",
  "missing_fields": ["seller_guidelines_accepted"]
}
```

### Missing Address Fields

HTTP `422`

```json
{
  "success": false,
  "message": "Full address is required.",
  "missing_fields": ["address_line_1", "city", "state", "country", "postal_code"]
}
```

### Payout Fields Sent Too Early

HTTP `400`

```json
{
  "success": false,
  "message": "Seller application does not accept payout or bank details.",
  "disallowed_fields": ["routing_number", "ssn_last_4"]
}
```

### User Is Already An Approved Seller

HTTP `409`

```json
{
  "success": false,
  "message": "User is already an approved seller.",
  "seller_application": {}
}
```

## Seller Application Status

Status is stored on the user object:

`user.seller_application.status`

Possible values:

- `pending`
- `approved`
- `rejected`

Useful user flags:

- `applied_seller = true` after application submit.
- `seller = false` while pending or rejected.
- `seller = true` after admin approval.
- `stripe_account` may still be `null` after approval.

Approved seller without `stripe_account` is valid. It means payout/profile setup is not complete yet.

## Admin Approval

Existing admin endpoint remains:

`PATCH /users/approveseller/:id`

Approve body:

```json
{
  "action": "approve"
}
```

Reject body:

```json
{
  "action": "reject",
  "rejection_reason": "Reason shown or stored for admin context"
}
```

On approval, backend sets:

- `seller = true`
- `applied_seller = true`
- `seller_application.status = approved`
- `seller_application.reviewed_at`
- `seller_application.reviewed_by` when available

If user already has `stripe_account`, backend keeps the old Stripe payout schedule update.
If user does not have `stripe_account`, approval still succeeds and Stripe is not called.

## Incomplete Seller Profile Error

Some seller actions require payout/KYC completion after approval.

Backend returns HTTP `403`:

```json
{
  "code": "SELLER_PROFILE_INCOMPLETE",
  "message": "Please complete your seller account information before continuing.",
  "missing_fields": [
    "payout_account",
    "stripe_account",
    "phone_number",
    "date_of_birth",
    "ssn_last_4",
    "bank_account"
  ]
}
```

Flutter handling:

1. Detect `code == SELLER_PROFILE_INCOMPLETE`.
2. Show a clear CTA such as "Complete seller account".
3. Navigate to the payout/Stripe Connect setup screen.
4. After Stripe Connect succeeds, retry the blocked action.

## Actions That Can Return SELLER_PROFILE_INCOMPLETE

The backend now guards:

- Create product: `POST /products/:useId`
- Bulk create products: `POST /products/products/bulkadd`
- Bulk publish/update products: `PUT /products/products/bulkedit/all`, `PUT /products/update`
- Publish/update product paths when publishing-related fields are sent
- Create live room/livestream: `POST /rooms`
- Create auction/live sale: `POST /auction`
- Start auction over socket event: `start-auction`
- Stripe bank listing: `GET /stripe/banks/:userId`
- Stripe payout: `POST /stripe/payouts/:userId`
- Stripe transfer: `POST /stripe/transfer`
- Stripe payout transactions: `GET /stripe/transactions/:userId`

Socket `start-auction` emits `auction-error` with the same object:

```json
{
  "code": "SELLER_PROFILE_INCOMPLETE",
  "message": "Please complete your seller account information before continuing.",
  "missing_fields": ["payout_account", "stripe_account", "phone_number", "date_of_birth", "ssn_last_4", "bank_account"]
}
```

## Stripe Connect / Payout Setup

Use this only after seller approval:

`POST /stripe/connect/:id`

Required fields remain the existing payout/KYC fields expected by Stripe Connect, for example:

```json
{
  "email": "seller@example.com",
  "first_name": "Jane",
  "last_name": "Seller",
  "routing_number": "110000000",
  "account_number": "000123456789",
  "phone": "+14155552671",
  "country": "United States",
  "postal_code": "94117",
  "line1": "123 Main St",
  "line2": "",
  "state": "CA",
  "city": "San Francisco",
  "day": 10,
  "month": 10,
  "year": 1985,
  "ssn_last_4": "6789",
  "countryCode": "US",
  "create_address": false
}
```

For non-US sellers, the existing endpoint supports `iban` and `countryCode`.

The response can contain:

```json
{
  "success": true,
  "account_created": true,
  "can_sell": false,
  "onboarding_required": true,
  "code": "STRIPE_ONBOARDING_REQUIRED",
  "stripe_status": {
    "ready": false,
    "can_sell": false,
    "onboarding_required": true,
    "verification_pending": false,
    "charges_enabled": false,
    "payouts_enabled": false,
    "card_payments": "pending",
    "transfers": "pending",
    "legacy_payments": "inactive",
    "currently_due": ["individual.id_number"],
    "pending_verification": []
  }
}
```

`success: true` means that the Stripe account exists. It does not mean the
account is approved to sell.

Stripe responses now include explicit frontend instructions:

```json
{
  "can_sell": false,
  "onboarding_required": true,
  "requires_onboarding_link": true,
  "next_action": "OPEN_STRIPE_ONBOARDING",
  "message": "Complete the required information in Stripe to activate your seller account."
}
```

Possible `next_action` values:

- `OPEN_STRIPE_ONBOARDING`: request and open a fresh onboarding link.
- `WAIT_FOR_STRIPE_VERIFICATION`: show a review-pending screen and a check-status action.
- `SELLER_READY`: continue to the seller action that originally triggered the flow.
- `CONTACT_SUPPORT`: show the backend message and a support action.
- `WAIT_FOR_SELLER_APPROVAL`: show the seller-application pending state.
- `COMPLETE_SELLER_PROFILE`: open the payout/KYC setup screen and call
  `POST /stripe/connect/:id` when the form is submitted.

Flutter must not show a generic error only because `can_sell == false`.

If `code == STRIPE_FUTURE_REQUIREMENTS_PENDING`, the account can currently be
eligible to sell, but Stripe has future verification information available for
collection. Flutter should still open onboarding when
`onboarding_required == true` to prevent a later restriction.

When `onboarding_required` is true, request a single-use Stripe-hosted
onboarding link:

`POST /stripe/connect/:id/onboarding-link`

```json
{
  "refresh_url": "https://steelz.live/stripe/refresh",
  "return_url": "https://steelz.live/stripe/return"
}
```

Open the returned `url` in a standalone browser, not an embedded WebView. After
Stripe returns to the app, call:

`GET /users/seller/eligibility/:userId`

Only allow selling when:

```text
can_sell == true
onboarding_required == false
verification_pending == false
```

The authenticated user ID must match `:userId` unless the caller is an admin.
Account Link URLs are single-use. If Stripe redirects to `refresh_url`, Flutter
must request a new onboarding link and open the new URL.

## Automatic Stripe Onboarding After Bank Setup

Do not add a separate confirmation step after the seller submits bank and KYC
information.

Use this flow:

1. Call `POST /stripe/connect/:id`.
2. Read `onboarding_required`, `verification_pending`, and `stripe_status`.
3. If `onboarding_required == true`, immediately request a fresh account link
   from `POST /stripe/connect/:id/onboarding-link`.
4. Open the returned URL in a standalone browser.
5. When Stripe returns to `/stripe/return`, call the eligibility endpoint
   again.
6. If Stripe redirects to `/stripe/refresh`, request a new account link. Never
   reuse the previous URL.

Recommended Flutter decision flow:

```dart
Future<void> handleStripeSellerResponse(Map<String, dynamic> data) async {
  switch (data['next_action']) {
    case 'OPEN_STRIPE_ONBOARDING':
      final link = await api.post(
        '/stripe/connect/$userId/onboarding-link',
        data: {
          'return_url': 'https://steelz.live/stripe/return',
          'refresh_url': 'https://steelz.live/stripe/refresh',
        },
      );
      await launchUrl(
        Uri.parse(link.data['url']),
        mode: LaunchMode.externalApplication,
      );
      return;
    case 'WAIT_FOR_STRIPE_VERIFICATION':
      showStripeReviewPending(data['message']);
      return;
    case 'SELLER_READY':
      continuePendingSellerAction();
      return;
    case 'WAIT_FOR_SELLER_APPROVAL':
      showSellerApplicationPending(data['message']);
      return;
    case 'COMPLETE_SELLER_PROFILE':
      openSellerPayoutSetup();
      return;
    default:
      showSellerSupportError(data['message']);
  }
}
```

Call this handler after:

- `POST /stripe/connect/:id`
- `POST /stripe/connect/:id/onboarding-link`
- `GET /users/seller/eligibility/:userId`
- returning to the app through `https://steelz.live/stripe/return`

Do not call `POST /stripe/connect/:id` again after returning from Stripe merely
to check status. Use the eligibility endpoint instead.

Stripe decides which missing information to display. The hosted form uses
`fields=currently_due` and `future_requirements=omit`, so it asks only for
requirements that need action now. Other future requirements remain visible in
the eligibility response without blocking selling. If Stripe lists
`individual.verification.document` as a future requirement, the backend blocks
selling and switches that account link to up-front onboarding so Stripe collects
the identity document before the seller starts selling.

## Identity Document Under Review

When Stripe has received a document and is reviewing it, the eligibility or
Stripe response contains:

```json
{
  "success": false,
  "can_sell": false,
  "code": "STRIPE_VERIFICATION_PENDING",
  "message": "Your identity document was submitted and is being reviewed by Stripe.",
  "onboarding_required": false,
  "verification_pending": true,
  "stripe_status": {
    "ready": false,
    "can_sell": false,
    "onboarding_required": false,
    "verification_pending": true,
    "currently_due": [],
    "past_due": [],
    "eventually_due": ["individual.verification.document"],
    "pending_verification": ["individual.verification.document"],
    "errors": []
  }
}
```

Flutter behavior:

- Do not open another onboarding link automatically.
- Show a non-success state such as "Your identity document is under review."
- Keep product, live, and auction creation blocked.
- Provide a "Check status" action that calls seller eligibility again.

If another requirement remains actionable while the document is under review,
`onboarding_required` remains `true`. In that case Flutter should open a new
onboarding link so the seller can complete the other requirement.

## Stripe Requirement Errors

`stripe_status.errors` and `stripe_status.future_requirements.errors` contain
Stripe requirement failures, such as an unreadable or expired document.

When `onboarding_required == true`, open hosted onboarding and let Stripe show
the corrective action. Do not display raw Stripe errors directly unless they
are mapped to safe, localized Flutter messages.

## Stripe Account Updated Webhook

The backend handles Stripe `account.updated` and stores a non-sensitive summary
on the user:

- `stripe_status_code`
- `stripe_verification_pending`
- `stripe_status_updated_at`

The Stripe Dashboard webhook configuration must include `account.updated` for
connected accounts. The live Stripe Account remains the source of truth;
Flutter must still call seller eligibility after returning from Stripe and
before a protected seller action.

If seller is not approved yet, backend returns:

HTTP `403`

```json
{
  "success": false,
  "code": "SELLER_NOT_APPROVED",
  "message": "Seller approval is required before completing payout setup."
}
```

On success, Stripe account is created and saved to `user.stripe_account`.

## Screen Changes Needed

### Seller Application Screens

Keep:

- Seller guidelines acceptance checkbox.
- Full address form.
- Optional social links form.
- Optional questions.

Remove or move out of seller application:

- Bank account number.
- Routing number.
- SSN last 4.
- Date of birth.
- Phone number.
- IBAN.
- Payout/payment details.

### Payout Setup Screen

Move bank/KYC fields to a separate "Complete seller account" or "Payout setup" screen.

Show this screen only:

- After admin approval, or
- When backend returns `SELLER_PROFILE_INCOMPLETE`.

### Status UI

Suggested UI behavior:

- `seller_application.status == pending`: show "Application under review".
- `seller_application.status == rejected`: show rejected state and allow resubmit if product wants that.
- `seller == true` and `stripe_account == null`: show seller dashboard but gate payout-required actions with "Complete seller account".
- `seller == true` and `stripe_account != null`: Stripe account exists, but it
  is not necessarily payout-ready. Use the seller eligibility endpoint and
  require `can_sell == true`.

## Backward Compatibility Notes

Existing sellers with an active Stripe account continue using
product/live/auction/payout flows. Restricted accounts are sent to Stripe
onboarding instead of being allowed to reach a payment failure.

Existing `/stripe/connect/:id` is not removed. It is only repositioned in the app flow.

Frontend should migrate from old initial seller application behavior:

Old:

`Seller application screen -> /stripe/connect/:id`

New:

`Seller application screen -> /users/seller/application`

Then later:

`Approved seller payout setup screen -> /stripe/connect/:id`
